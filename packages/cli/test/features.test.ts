import {afterEach,describe,expect,it,vi} from 'vitest';
import {cli,forwardTarget,type CliIO} from '../src/core';
afterEach(()=>vi.unstubAllGlobals());
const ID='10000000-0000-4000-8000-000000000001';
const EV='20000000-0000-4000-8000-000000000002';
function fixture(){const out:string[]=[];const err:string[]=[];const io:CliIO={out:t=>out.push(t),err:t=>err.push(t),read:async()=>'opc_synthetic',save:async()=>undefined,clear:async()=>undefined,open:()=>undefined,run:vi.fn(async()=>0)};return {io,out,err};}
type Call={url:string;init:RequestInit};
function server(handler:(url:string,init:RequestInit)=>Response){const calls:Call[]=[];vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});return handler(url,init);});return calls;}
const KEY={OPIKEY:'synthetic-parent-key'};

describe('opi run --subkey',()=>{
 it('gives the program only a gateway sub-key, never raw secrets or the parent key, and revokes it afterwards',async()=>{const {io}=fixture();const calls=server(url=>url.endsWith('/delegate')?Response.json({id:ID,key:'opk_live_child',expires_at:'2026-12-01T00:00:00Z'},{status:201}):Response.json({revoked:1}));
  const code=await cli(['run','--subkey','--ttl','600','--secrets','openai,exa','--max-calls','50','--','node','agent.js'],io,{...KEY,PATH:'/bin'});
  expect(code).toBe(0);const delegate=JSON.parse(String(calls[0]?.init.body));expect(delegate).toMatchObject({ttl_seconds:600,process:true,modes:['gateway'],secrets:['openai','exa'],max_calls:50});
  expect(io.run).toHaveBeenCalledWith('node',['agent.js'],{PATH:'/bin',OPIKEY:'opk_live_child',OPIKEY_BASE_URL:'https://opikey.ai'});
  expect(calls[1]?.url).toBe(`https://opikey.ai/api/public/keys/${ID}/revoke`);expect(calls.some(c=>c.url.includes('secrets-fetch'))).toBe(false);});
 it('still revokes the sub-key when the program fails',async()=>{const {io}=fixture();io.run=vi.fn(async()=>{throw new Error('crash');});const calls=server(url=>url.endsWith('/delegate')?Response.json({id:ID,key:'k',expires_at:'x'},{status:201}):Response.json({revoked:1}));await expect(cli(['run','--subkey','--','x'],io,KEY)).rejects.toThrow('crash');expect(calls.at(-1)?.url).toContain('/revoke');});
 it('requires OPIKEY for agent commands and never reads a key from arguments',async()=>{const {io,err}=fixture();expect(await cli(['run','--subkey','--','x'],io,{})).toBe(64);expect(err.join()).toContain('OPIKEY');});
});

describe('sub-key commands',()=>{
 it('prints only the one-time key on stdout so it can be redirected to a file',async()=>{const {io,out,err}=fixture();server(()=>Response.json({id:ID,key:'opk_live_child',expires_at:'2026-12-01T00:00:00Z'},{status:201}));expect(await cli(['subkey','create','--ttl','3600','--name','scraper','--budget','500','--delegate'],io,KEY)).toBe(0);expect(out).toEqual(['OPIKEY=opk_live_child']);expect(err.join()).toContain('shown once');});
 it('requires --ttl',async()=>{const {io}=fixture();expect(await cli(['subkey','create'],io,KEY)).toBe(64);});
 it('shows a safe error code from the server',async()=>{const {io,err}=fixture();server(()=>Response.json({error:{code:'delegation_not_allowed'}},{status:403}));expect(await cli(['subkey','create','--ttl','60'],io,KEY)).toBe(1);expect(err.join()).toContain('delegation_not_allowed');});
 it('revokes by id',async()=>{const {io,out}=fixture();const calls=server(()=>Response.json({revoked:3}));await cli(['subkey','revoke',ID],io,KEY);expect(calls[0]?.url).toBe(`https://opikey.ai/api/public/keys/${ID}/revoke`);expect(out).toEqual(['Revoked 3 key(s).']);});
});

describe('AI mode and credits',()=>{
 it('prints the answer of a finished AI run',async()=>{const {io,out}=fixture();server(()=>Response.json({id:ID,status:'completed',steps:2,credits:140,answer:'uuid-123',error:null,pending_action:null}));expect(await cli(['ai','Get a UUID from httpbin'],io,KEY)).toBe(0);expect(out).toEqual(['uuid-123']);});
 it('exits 2 and prints the run id when a write needs approval',async()=>{const {io,out}=fixture();server(()=>Response.json({id:ID,status:'awaiting_confirmation',steps:1,credits:60,answer:null,error:null,pending_action:{method:'POST',api:'httpbin',path:'/anything',approved:false}}));expect(await cli(['ai','post hello'],io,KEY)).toBe(2);expect(out).toEqual([ID]);});
 it('shows credits',async()=>{const {io,out}=fixture();server(()=>Response.json({balance:150000,monthly_remaining:100000,purchased_remaining:50000,next_grant_at:null}));await cli(['credits'],io,KEY);expect(out[0]).toContain('150,000 credits');});
});

describe('inbox',()=>{
 const event={id:EV,type:'push',received_at:'t',verified:true,delivery_count:1,content_type:'application/json',headers:{},body:{ref:'main'},security:null,status:'leased',credits:1};
 it('creates an inbox with a generated secret and prints the receiving URL',async()=>{const {io,out}=fixture();const calls=server(()=>Response.json({id:ID,url:'https://opikey.ai/api/public/inbox/in/abc',setup:'Add it in GitHub.'},{status:201}));await cli(['inbox','create','--name','CI','--source','github','--generate'],io,KEY);expect(JSON.parse(String(calls[0]?.init.body))).toEqual({name:'CI',source:'github',secret:'generate'});expect(out).toEqual(['https://opikey.ai/api/public/inbox/in/abc']);});
 it('rejects unknown sources',async()=>{const {io}=fixture();expect(await cli(['inbox','create','--name','x','--source','email'],io,KEY)).toBe(64);});
 it('listen forwards to a local app and acks only after a 2xx',async()=>{const controller=new AbortController();const {io}=fixture();io.signal=controller.signal;let nexts=0;const calls=server(url=>{if(url.includes('/next')){nexts++;if(nexts===1)return Response.json({event});if(nexts===2)return Response.json({event:{...event,id:'30000000-0000-4000-8000-000000000003'}});controller.abort();return new Response(null,{status:204});}if(url.startsWith('http://localhost'))return new Response('ok',{status:nexts===1?200:500});return Response.json({acked:true});});
  expect(await cli(['inbox','listen',ID,'--forward','http://localhost:3000/hook'],io,KEY)).toBe(0);
  const local=calls.filter(c=>c.url==='http://localhost:3000/hook');expect(local).toHaveLength(2);expect(local[0]?.init.body).toBe('{"ref":"main"}');expect(new Headers(local[0]?.init.headers).get('x-opi-event-id')).toBe(EV);
  expect(calls.filter(c=>c.url.endsWith('/ack')).map(c=>c.url)).toEqual([`https://opikey.ai/api/public/inbox/${ID}/events/${EV}/ack`]);});
 it('only forwards to https or localhost',()=>{expect(()=>forwardTarget('http://example.com/hook')).toThrow();expect(()=>forwardTarget('https://u:p@example.com')).toThrow();expect(forwardTarget('http://127.0.0.1:8080/x').port).toBe('8080');expect(forwardTarget('https://hooks.example.com/x').hostname).toBe('hooks.example.com');});
});
