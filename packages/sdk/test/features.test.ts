import {afterEach,describe,expect,it,vi} from 'vitest';
import {Opi,OpiError,OpiInsufficientCreditsError,OpiBudgetExhaustedError,OpiSecurityBlockedError,OpiForbiddenError,OpiTimeoutError,type InboxEvent} from '../src/index';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const ID='10000000-0000-4000-8000-000000000001';
const EV='20000000-0000-4000-8000-000000000002';
type Call={url:string;init:RequestInit};
function server(handler:(url:string,init:RequestInit)=>Response|Promise<Response>){const calls:Call[]=[];vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});return handler(url,init);});return calls;}
const body=(c:Call|undefined)=>JSON.parse(String(c?.init.body));
const opi=()=>new Opi({key:'synthetic'});

describe('sub-keys',()=>{
 it('delegates with the exact contract fields and returns the one-time key',async()=>{const calls=server(()=>Response.json({id:ID,key:'opk_live_child',name:'scraper',depth:1,expires_at:'2026-12-01T00:00:00Z',can_delegate:false,max_calls:100,secrets:['exa'],modes:['gateway']},{status:201}));
  const child=await opi().keys.delegate({ttl_seconds:3600,name:'scraper',secrets:['exa'],max_calls:100,budget_credits:500});
  expect(calls[0]?.url).toBe('https://opikey.ai/api/public/keys/delegate');expect(calls[0]?.init.method).toBe('POST');expect(body(calls[0])).toEqual({ttl_seconds:3600,name:'scraper',secrets:['exa'],max_calls:100,budget_credits:500});expect(child.key).toBe('opk_live_child');});
 it('rejects a too-short ttl before any request',async()=>{const calls=server(()=>Response.json({}));await expect(opi().keys.delegate({ttl_seconds:10})).rejects.toMatchObject({code:'invalid_request'});expect(calls).toHaveLength(0);});
 it('surfaces exceeds_parent with its field and insufficient_budget with available credits',async()=>{server(()=>Response.json({error:{code:'exceeds_parent',message:'x',field:'secrets'}},{status:422}));await expect(opi().keys.delegate({ttl_seconds:60})).rejects.toMatchObject({code:'exceeds_parent',details:{field:'secrets'}});
  server(()=>Response.json({error:{code:'insufficient_budget',available_credits:40}},{status:422}));await expect(opi().keys.delegate({ttl_seconds:60,budget_credits:100})).rejects.toMatchObject({code:'insufficient_budget',details:{available_credits:40}});});
 it('reads self, children and roles, and controls subtrees by id',async()=>{const calls=server(url=>url.endsWith('/self')?Response.json({id:ID,budget:{available_credits:9}}):url.endsWith('/children')?Response.json({children:[{id:ID}]}):url.endsWith('/roles')?Response.json({roles:[{name:'researcher',summary:null}]}):Response.json({revoked:2,returned_calls:5,returned_credits:7}));
  const o=opi();expect((await o.keys.self()).budget?.available_credits).toBe(9);expect(await o.keys.children()).toEqual([{id:ID}]);expect((await o.keys.roles())[0]?.name).toBe('researcher');expect(await o.keys.revoke(ID)).toEqual({revoked:2,returned_calls:5,returned_credits:7});await o.keys.pause(ID);await o.keys.resume(ID);
  expect(calls.slice(3).map(c=>c.url)).toEqual([`https://opikey.ai/api/public/keys/${ID}/revoke`,`https://opikey.ai/api/public/keys/${ID}/pause`,`https://opikey.ai/api/public/keys/${ID}/resume`]);});
 it('refuses non-UUID ids so paths cannot be injected',async()=>{const calls=server(()=>Response.json({}));await expect(opi().keys.revoke('../self')).rejects.toBeInstanceOf(OpiError);expect(calls).toHaveLength(0);});
});

describe('errors for credits and security',()=>{
 it('maps 402 to OpiInsufficientCreditsError with needed/available',async()=>{server(()=>Response.json({error:{code:'insufficient_credits',needed:10,available:3}},{status:402}));const e=await opi().fetch('openai','/v1/models').catch(x=>x);expect(e).toBeInstanceOf(OpiInsufficientCreditsError);expect(e.details).toEqual({needed:10,available:3});});
 it('maps budget_exhausted and calls_exhausted to OpiBudgetExhaustedError',async()=>{for(const code of ['budget_exhausted','calls_exhausted']){server(()=>Response.json({error:{code}},{status:429}));await expect(opi().fetch('a','/x')).rejects.toBeInstanceOf(OpiBudgetExhaustedError);}});
 it('maps security_blocked to OpiSecurityBlockedError with the incident id',async()=>{server(()=>Response.json({error:{code:'security_blocked',message:'blocked',incident_id:ID}},{status:403}));const e=await opi().fetch('a','/x').catch(x=>x);expect(e).toBeInstanceOf(OpiSecurityBlockedError);expect(e.incidentId).toBe(ID);});
 it('drops unsafe detail values instead of echoing them',async()=>{server(()=>Response.json({error:{code:'forbidden',message:'secret sk_live_abc',note:'has spaces and sk_live_abc <script>',ok:'fine_value'}},{status:403}));const e=await opi().fetch('a','/x').catch(x=>x);expect(e.message).not.toContain('sk_live');expect(e.details).toEqual({ok:'fine_value'});});
 it('reads the credit balance',async()=>{const calls=server(()=>Response.json({balance:5000,monthly_remaining:5000,purchased_remaining:0,next_grant_at:null}));expect((await opi().credits()).balance).toBe(5000);expect(calls[0]?.url).toBe('https://opikey.ai/api/public/credits');});
});

describe('AI mode',()=>{
 it('starts a run with the task',async()=>{const calls=server(()=>Response.json({id:ID,status:'completed',answer:'42'}));const run=await opi().ai.run('Get a UUID from httpbin');expect(run.answer).toBe('42');expect(calls[0]?.url).toBe('https://opikey.ai/api/public/ai/v1/runs/');expect(body(calls[0])).toEqual({task:'Get a UUID from httpbin'});});
 it('rejects empty or oversized tasks locally',async()=>{await expect(opi().ai.run('')).rejects.toMatchObject({code:'invalid_request'});await expect(opi().ai.run('x'.repeat(4001))).rejects.toMatchObject({code:'invalid_request'});});
 it('runAndWait waits for approval, continues once, and returns the finished run',async()=>{let polls=0;const calls=server((url,init)=>{if(init.method==='POST'&&url.endsWith('/runs/'))return Response.json({id:ID,status:'awaiting_confirmation',pending_action:{method:'POST',api:'httpbin',path:'/anything',approved:false}});if(url.endsWith('/continue'))return Response.json({id:ID,status:'completed',answer:'done'});polls++;return Response.json({id:ID,status:'awaiting_confirmation',pending_action:{approved:polls>1}});});
  const run=await opi().ai.runAndWait('post hello',{timeoutMs:5000,intervalMs:1});expect(run.status).toBe('completed');expect(calls.filter(c=>c.url.endsWith('/continue'))).toHaveLength(1);});
 it('runAndWait times out if the owner never approves',async()=>{server((url,init)=>init.method==='POST'?Response.json({id:ID,status:'awaiting_confirmation',pending_action:{approved:false}}):Response.json({id:ID,status:'awaiting_confirmation',pending_action:{approved:false}}));await expect(opi().ai.runAndWait('x',{timeoutMs:20,intervalMs:5})).rejects.toBeInstanceOf(OpiTimeoutError);});
});

describe('Inbox',()=>{
 const event:InboxEvent={id:EV,type:'push',received_at:'t',verified:true,delivery_count:1,content_type:'application/json',headers:{},body:{ok:true},security:null,status:'leased',credits:1};
 it('creates with a generated secret and never sends a secret value',async()=>{const calls=server(()=>Response.json({id:ID,url:'https://opikey.ai/api/public/inbox/in/abc',setup:'…'},{status:201}));await opi().inbox.create({name:'CI',source:'github',secret:'generate'});expect(body(calls[0])).toEqual({name:'CI',source:'github',secret:'generate'});});
 it('next returns the event, or null on 204, and clamps wait to 30',async()=>{const calls=server(()=>Response.json({event}));expect(await opi().inbox.next(ID,{wait:99,type:'push'})).toEqual(event);expect(calls[0]?.url).toBe(`https://opikey.ai/api/public/inbox/${ID}/next?wait=30&type=push`);
  server(()=>new Response(null,{status:204}));expect(await opi().inbox.next(ID,{wait:1})).toBeNull();});
 it('acks, browses, closes and rotates by id',async()=>{const calls=server(url=>url.includes('/events?')?Response.json({events:[event]}):url.endsWith('/rotate-url')?Response.json({ok:true,url:'https://new'}):Response.json({ok:true,acked:true}));const o=opi();await o.inbox.ack(ID,EV);expect(await o.inbox.events(ID,{status:'new',limit:5})).toEqual([event]);await o.inbox.close(ID);expect(await o.inbox.rotateUrl(ID)).toBe('https://new');
  expect(calls.map(c=>c.url)).toEqual([`https://opikey.ai/api/public/inbox/${ID}/events/${EV}/ack`,`https://opikey.ai/api/public/inbox/${ID}/events?status=new&limit=5`,`https://opikey.ai/api/public/inbox/${ID}/close`,`https://opikey.ai/api/public/inbox/${ID}/rotate-url`]);});
 it('listen acks handled messages and leaves failed ones unacked',async()=>{const controller=new AbortController();let served=0;const calls=server(url=>{if(url.includes('/next')){served++;if(served===1)return Response.json({event});if(served===2)return Response.json({event:{...event,id:'30000000-0000-4000-8000-000000000003'}});controller.abort();return new Response(null,{status:204});}return Response.json({acked:true});});
  const seen:string[]=[];const errors:unknown[]=[];await opi().inbox.listen(ID,e=>{seen.push(e.id);if(e.id!==EV)throw new Error('handler failed');},{signal:controller.signal,onError:x=>errors.push(x)});
  expect(seen).toHaveLength(2);expect(errors).toHaveLength(1);expect(calls.filter(c=>c.url.endsWith('/ack')).map(c=>c.url)).toEqual([`https://opikey.ai/api/public/inbox/${ID}/events/${EV}/ack`]);});
});

describe('Instant API accounts',()=>{
 it('finds providers with a query',async()=>{const calls=server(()=>Response.json({providers:[{slug:'example-search'}]}));expect(await opi().accounts.find({query:'search'})).toEqual([{slug:'example-search'}]);expect(calls[0]?.url).toBe('https://opikey.ai/api/public/accounts/providers?q=search');});
 it('connects and returns the vault secret name, never a key',async()=>{server(()=>Response.json({status:'connected',secret:'example-search',gateway:'https://opikey.ai/api/public/gateway/example-search'}));const r=await opi().accounts.connect('example-search');expect(r).toEqual({status:'connected',secret:'example-search',gateway:'https://opikey.ai/api/public/gateway/example-search'});});
 it('waits for owner approval, then connects again',async()=>{let connects=0;const calls=server(url=>{if(url.endsWith('/connect')){connects++;return connects===1?Response.json({status:'needs_approval',approval_id:ID},{status:202}):Response.json({status:'connected',secret:'s',gateway:'g'});}return Response.json({status:'approved'});});
  const r=await opi().accounts.connect('example-search',{plan:'free',waitForApprovalMs:5000});expect(r.status).toBe('connected');expect(body(calls[0])).toEqual({provider:'example-search',plan:'free'});expect(calls.some(c=>c.url.endsWith(`/approvals/${ID}`))).toBe(true);});
 it('throws when the owner rejects the account',async()=>{server(url=>url.endsWith('/connect')?Response.json({status:'needs_approval',approval_id:ID},{status:202}):Response.json({status:'rejected'}));await expect(opi().accounts.connect('p',{waitForApprovalMs:5000})).rejects.toBeInstanceOf(OpiForbiddenError);});
 it('validates provider slugs locally',async()=>{await expect(opi().accounts.connect('Bad Slug!')).rejects.toMatchObject({code:'invalid_request'});});
});
