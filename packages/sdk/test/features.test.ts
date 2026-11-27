import {afterEach,describe,expect,it,vi} from 'vitest';
import {OpiKey,Opi,OpiError,OpiKeyError,OpiInsufficientCreditsError,InsufficientCreditsError,OpiBudgetExhaustedError,OpiSecurityBlockedError,OpiApprovalRequiredError,OpiConfirmationError,OpiFeaturePausedError,OpiAiUnavailableError,OpiForbiddenError,OpiAuthError,type AiResult} from '../src/index';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const ID='10000000-0000-4000-8000-000000000001';
type Call={url:string;init:RequestInit};
function server(handler:(url:string,init:RequestInit)=>Response|Promise<Response>){const calls:Call[]=[];vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});return handler(url,init);});return calls;}
const body=(c:Call|undefined)=>JSON.parse(String(c?.init.body));
const opi=()=>new OpiKey({key:'synthetic'});
const usage={api_calls:1,model:'google/gemini-3.1-flash-lite',input_tokens:1520,output_tokens:310,model_cost_usd:0.00084,ai_credits:21,call_credits:13,total_credits:34};
const check={verdict:'allowed',tier:2,reason:'passed',ai:{used:true,why:'write'}};
const done:AiResult={result:'Sent.',calls:[{api:'resend',method:'POST',path:'/emails',status:200}],status:'done',usage,check};

describe('client',()=>{
 it('reads OPIKEY_KEY, then OPIKEY, and keeps Opi as an alias',async()=>{const calls=server(()=>Response.json({secrets:[]}));vi.stubEnv('OPIKEY_KEY','from-new-var');await new OpiKey().listSecrets();expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer from-new-var');
  vi.unstubAllEnvs();vi.stubEnv('OPIKEY_KEY','');vi.stubEnv('OPIKEY','from-old-var');await new Opi().listSecrets();expect(new Headers(calls[1]?.init.headers).get('authorization')).toBe('Bearer from-old-var');expect(Opi).toBe(OpiKey);});
 it('requires a key',()=>{vi.stubEnv('OPIKEY_KEY','');vi.stubEnv('OPIKEY','');expect(()=>new OpiKey()).toThrow(OpiAuthError);});
 it('refuses to run in browser code unless allowed',()=>{vi.stubGlobal('window',{});vi.stubGlobal('document',{});expect(()=>opi()).toThrow(/browser/);expect(()=>new OpiKey({key:'synthetic',allowBrowser:true})).not.toThrow();});
 it('exports the documented error names',()=>{expect(OpiKeyError).toBe(OpiError);expect(InsufficientCreditsError).toBe(OpiInsufficientCreditsError);});
});

describe('AI mode',()=>{
 it('sends the input and model, and returns result, calls, usage and check',async()=>{const calls=server(()=>Response.json(done));const r=await opi().ai('send Sam a receipt for order 1042 with Resend',{model:'fast'});
  expect(calls[0]?.url).toBe('https://opikey.ai/api/public/v1/ai');expect(calls[0]?.init.method).toBe('POST');expect(body(calls[0])).toEqual({input:'send Sam a receipt for order 1042 with Resend',model:'fast'});
  expect(r.status).toBe('done');expect(r.usage.total_credits).toBe(34);expect(r.check.ai?.used).toBe(true);});
 it('returns a preview for risky writes, then runs it with confirm_id',async()=>{const preview={...done,status:'needs_confirmation',calls:[],confirm_id:ID,planned_calls:[{api:'stripe',method:'DELETE',path:'/v1/customers/cus_1'}],reason:'Deletes a customer'};
  const calls=server((_,init)=>Response.json(JSON.parse(String(init.body)).confirm_id?done:preview));const o=opi();
  const first=await o.ai('delete customer cus_1');expect(first.status).toBe('needs_confirmation');expect(first.planned_calls?.[0]?.method).toBe('DELETE');
  const second=await o.ai('delete customer cus_1',{confirmId:first.confirm_id!});expect(second.status).toBe('done');expect(body(calls[1])).toEqual({input:'delete customer cus_1',confirm_id:ID});});
 it('validates input, model and confirm_id before any request',async()=>{const calls=server(()=>Response.json(done));
  await expect(opi().ai('')).rejects.toMatchObject({code:'invalid_request'});await expect(opi().ai('x'.repeat(4001))).rejects.toMatchObject({code:'invalid_request'});
  await expect(opi().ai('hi',{model:'huge' as never})).rejects.toMatchObject({code:'invalid_request'});await expect(opi().ai('hi',{confirmId:'../x'})).rejects.toMatchObject({code:'invalid_request'});expect(calls).toHaveLength(0);});
 it.each([[409,'confirmation_invalid',OpiConfirmationError],[503,'ai_mode_unavailable',OpiAiUnavailableError],[410,'feature_paused',OpiFeaturePausedError],[403,'browser_origin_blocked',OpiForbiddenError],[403,'check_held',OpiApprovalRequiredError]] as const)('maps %s %s to a typed error',async(status,code,klass)=>{server(()=>Response.json({error:{code}},{status}));await expect(opi().ai('hi')).rejects.toBeInstanceOf(klass);});
});

describe('exact calls',()=>{
 it('builds the gateway path, query and JSON body, and parses check, usage and credits from headers',async()=>{const calls=server(()=>Response.json({id:'em_1'},{headers:{'x-opi-check':JSON.stringify(check),'x-opi-usage':JSON.stringify({...usage,ai_credits:0,total_credits:13}),'x-opi-credits-charged':'13'}}));
  const r=await opi().call({api:'resend',method:'POST',path:'/emails',query:{dry:true,skip:undefined},body:{to:'sam@example.com'}});
  expect(calls[0]?.url).toBe('https://opikey.ai/api/public/gateway/resend/emails?dry=true');expect(calls[0]?.init.method).toBe('POST');expect(body(calls[0])).toEqual({to:'sam@example.com'});expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json');
  expect(r.ok).toBe(true);expect(r.check?.verdict).toBe('allowed');expect(r.usage?.total_credits).toBe(13);expect(r.creditsCharged).toBe(13);expect(await r.response.json()).toEqual({id:'em_1'});});
 it('never sends a body on GET and ignores malformed headers',async()=>{const calls=server(()=>new Response('ok',{headers:{'x-opi-check':'not json','x-opi-credits-charged':'lots'}}));const r=await opi().call({api:'openai',path:'/v1/models',body:{ignored:true}});expect(calls[0]?.init.body).toBeUndefined();expect(r.check).toBeNull();expect(r.creditsCharged).toBeNull();});
 it('returns the provider\'s own error responses instead of throwing',async()=>{server(()=>Response.json({error:{code:'resource_missing',message:'No such customer'}},{status:404}));const r=await opi().call({api:'stripe',path:'/v1/customers/cus_x'});expect(r.ok).toBe(false);expect(r.status).toBe(404);});
 it('throws OPIKey errors: credits, limits and the AI Firewall',async()=>{server(()=>Response.json({error:{code:'insufficient_credits',needed:13,available:2}},{status:402}));const e=await opi().call({api:'a',path:'/x'}).catch(x=>x);expect(e).toBeInstanceOf(OpiInsufficientCreditsError);expect(e.details).toEqual({needed:13,available:2});
  server(()=>Response.json({error:{code:'call_limit_reached'}},{status:429}));await expect(opi().call({api:'a',path:'/x'})).rejects.toBeInstanceOf(OpiBudgetExhaustedError);
  server(()=>Response.json({error:{code:'security_blocked',incident_id:ID}},{status:403}));const b=await opi().call({api:'a',path:'/x'}).catch(x=>x);expect(b).toBeInstanceOf(OpiSecurityBlockedError);expect(b.incidentId).toBe(ID);});
 it('rejects bad API names, paths and methods before any request',async()=>{const calls=server(()=>Response.json({}));await expect(opi().call({api:'../x',path:'/y'})).rejects.toBeInstanceOf(OpiError);await expect(opi().call({api:'a',path:'//evil.example'})).rejects.toBeInstanceOf(OpiError);await expect(opi().call({api:'a',path:'/x',method:'TRACE' as never})).rejects.toBeInstanceOf(OpiError);expect(calls).toHaveLength(0);});
 it('drops unsafe detail values instead of echoing them',async()=>{server(()=>Response.json({error:{code:'forbidden',message:'secret sk_live_abc',note:'has spaces and sk_live_abc <script>',ok:'fine_value'}},{status:403}));const e=await opi().fetch('a','/x').catch(x=>x);expect(e.message).not.toContain('sk_live');expect(e.details).toEqual({ok:'fine_value'});});
});

describe('usage',()=>{
 it('reads this month\'s credits and breakdown',async()=>{const u={credits_left:84500,credits_included:150000,credits_used:65500,extra_credits_left:0,resets_at:'2026-12-01T00:00:00Z',breakdown:{api_calls:52000,ai_mode:12000,ai_firewall:1500}};const calls=server(()=>Response.json(u));expect(await opi().usage()).toEqual(u);expect(calls[0]?.url).toBe('https://opikey.ai/api/public/usage');});
 it('keeps the deprecated credits() call working',async()=>{const calls=server(()=>Response.json({balance:5000,monthly_remaining:5000,purchased_remaining:0,next_grant_at:null}));expect((await opi().credits()).balance).toBe(5000);expect(calls[0]?.url).toBe('https://opikey.ai/api/public/credits');});
});

describe('this key',()=>{
 it('whoami reads the key\'s own settings',async()=>{const info={id:ID,name:'CLI on MacBook',prefix:'opk_live_ab12',access:'all',apis:['openai','stripe'],firewall_level:'standard',ai_writes:'auto',expires_at:null};const calls=server(()=>Response.json(info));expect(await opi().whoami()).toEqual(info);expect(calls[0]?.url).toBe('https://opikey.ai/api/public/v1/key');});
 it('revokeThisKey revokes the calling key only',async()=>{const calls=server(()=>Response.json({revoked:true}));await opi().revokeThisKey();expect(calls[0]?.url).toBe('https://opikey.ai/api/public/v1/key/revoke');expect(calls[0]?.init.method).toBe('POST');expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer synthetic');});
});
