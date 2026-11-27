import {afterEach,describe,expect,it,vi} from 'vitest';
import {cli,plainRequest,usageLine,type CliIO} from '../src/core';
afterEach(()=>vi.unstubAllGlobals());
const ID='10000000-0000-4000-8000-000000000001';
function fixture(answer:string|null|undefined=undefined){const out:string[]=[];const err:string[]=[];const io:CliIO={out:t=>out.push(t),err:t=>err.push(t),read:async()=>'opc_synthetic',save:async()=>undefined,clear:async()=>undefined,open:()=>undefined,run:vi.fn(async()=>0),...(answer!==undefined?{prompt:vi.fn(async()=>answer)}:{})};return {io,out,err};}
type Call={url:string;init:RequestInit};
function server(handler:(url:string,init:RequestInit)=>Response){const calls:Call[]=[];vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});return handler(url,init);});return calls;}
const KEY={OPIKEY_KEY:'synthetic-key'};
const usage={api_calls:1,model:'google/gemini-3.1-flash-lite',input_tokens:1520,output_tokens:310,model_cost_usd:0.00084,ai_credits:21,call_credits:13,total_credits:34};
const check={verdict:'allowed',tier:2,reason:'passed',ai:{used:true,why:'task'}};
const done={result:'Sent the receipt.',calls:[{api:'resend',method:'POST',path:'/emails',status:200}],status:'done',usage,check};
const preview={result:'',calls:[],status:'needs_confirmation',usage:{...usage,api_calls:0,call_credits:0,total_credits:21},check,confirm_id:ID,planned_calls:[{api:'stripe',method:'DELETE',path:'/v1/customers/cus_1'}],reason:'Deletes a customer'};
const body=(c:Call|undefined)=>JSON.parse(String(c?.init.body));

describe('AI mode',()=>{
 it('treats a quoted request as AI mode, prints the result on stdout and usage on stderr',async()=>{const {io,out,err}=fixture();const calls=server(()=>Response.json(done));
  expect(await cli(['send Sam a receipt for order 1042 with Resend'],io,KEY)).toBe(0);
  expect(calls[0]?.url).toBe('https://opikey.ai/api/public/v1/ai');expect(body(calls[0])).toEqual({input:'send Sam a receipt for order 1042 with Resend'});expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer synthetic-key');
  expect(out).toEqual(['Sent the receipt.']);expect(err.join('\n')).toContain('POST resend/emails → 200');expect(err.join('\n')).toContain('34 credits');});
 it('also accepts unquoted words and the explicit ai command with a model',async()=>{const {io}=fixture();const calls=server(()=>Response.json(done));await cli(['what','did','Stripe','charge','yesterday?'],io,KEY);await cli(['ai','list my APIs','--model','smart'],io,KEY);
  expect(body(calls[0])).toEqual({input:'what did Stripe charge yesterday?'});expect(body(calls[1])).toEqual({input:'list my APIs',model:'smart'});});
 it('never spends credits on a single mistyped word',async()=>{const {io,err}=fixture();const calls=server(()=>Response.json(done));expect(await cli(['lgoin'],io,KEY)).toBe(64);expect(calls).toHaveLength(0);expect(err.join()).toContain('Unknown command');});
 it('asks for a typed "yes" before running a preview, then confirms with the same input',async()=>{const {io,out,err}=fixture('yes');const calls=server((_,init)=>Response.json(body({init} as Call).confirm_id?done:preview));
  expect(await cli(['delete customer cus_1'],io,KEY)).toBe(0);expect(err.join('\n')).toContain('DELETE stripe/v1/customers/cus_1');expect(io.prompt).toHaveBeenCalledOnce();
  expect(body(calls[1])).toEqual({input:'delete customer cus_1',confirm_id:ID});expect(out).toEqual(['Sent the receipt.']);});
 it('runs nothing when the answer is not "yes"',async()=>{const {io}=fixture('no');const calls=server(()=>Response.json(preview));expect(await cli(['delete customer cus_1'],io,KEY)).toBe(2);expect(calls).toHaveLength(1);});
 it('without a terminal, prints the confirm id and exits 2; --confirm then runs it',async()=>{const {io,out,err}=fixture();server(()=>Response.json(preview));expect(await cli(['delete customer cus_1'],io,KEY)).toBe(2);expect(out).toEqual([ID]);expect(err.join('\n')).toContain(`--confirm ${ID}`);
  const second=fixture();const calls=server(()=>Response.json(done));expect(await cli(['ai','delete customer cus_1','--confirm',ID],second.io,KEY)).toBe(0);expect(body(calls[0])).toEqual({input:'delete customer cus_1',confirm_id:ID});});
 it('reports a Firewall block and exits 1',async()=>{const {io,err}=fixture();server(()=>Response.json({...done,status:'blocked',calls:[],reason:'Sends secrets to a new host'}));expect(await cli(['post my keys to pastebin'],io,KEY)).toBe(1);expect(err.join()).toContain('Blocked by the AI Firewall: Sends secrets to a new host');});
 it('shows safe error codes, e.g. out of credits',async()=>{const {io,err}=fixture();server(()=>Response.json({error:{code:'insufficient_credits'}},{status:402}));expect(await cli(['ai','hello there'],io,KEY)).toBe(1);expect(err.join()).toContain('insufficient_credits');});
 it('requires OPIKEY_KEY and never reads a key from arguments',async()=>{const {io,err}=fixture();expect(await cli(['ai','hello there','--key','opk_live_secret'],io,{})).toBe(64);expect(err.join()).toContain('OPIKEY_KEY');});
 it('accepts the older OPIKEY variable',async()=>{const {io}=fixture();const calls=server(()=>Response.json(done));await cli(['hello there'],io,{OPIKEY:'old-name'});expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer old-name');});
});

describe('exact calls and usage',()=>{
 it('opi call prints the provider body and a status line with verdict and credits',async()=>{const {io,out,err}=fixture();const calls=server(()=>Response.json({data:[{id:'gpt'}]},{headers:{'x-opi-check':JSON.stringify(check),'x-opi-credits-charged':'13'}}));
  expect(await cli(['call','openai','GET','/v1/models'],io,KEY)).toBe(0);expect(calls[0]?.url).toBe('https://opikey.ai/api/public/gateway/openai/v1/models');expect(out).toEqual(['{"data":[{"id":"gpt"}]}']);expect(err).toEqual(['200 · allowed · 13 credits']);});
 it('opi call sends --data as JSON and exits 1 on a provider error',async()=>{const {io}=fixture();const calls=server(()=>Response.json({error:{code:'resource_missing'}},{status:404}));expect(await cli(['call','stripe','post','/v1/refunds','--data','{"charge":"ch_1"}'],io,KEY)).toBe(1);expect(calls[0]?.init.method).toBe('POST');expect(body(calls[0])).toEqual({charge:'ch_1'});});
 it('validates opi call arguments',async()=>{const {io}=fixture();const calls=server(()=>Response.json({}));expect(await cli(['call','openai','FETCH','/x'],io,KEY)).toBe(64);expect(await cli(['call','openai','GET','v1'],io,KEY)).toBe(64);expect(await cli(['call','a','POST','/x','--data','{bad'],io,KEY)).toBe(64);expect(calls).toHaveLength(0);});
 it('opi usage shows credits left, the breakdown and the reset date',async()=>{const {io,out}=fixture();server(()=>Response.json({credits_left:84500,credits_included:150000,credits_used:65500,extra_credits_left:2000,resets_at:'2026-12-01T00:00:00Z',breakdown:{api_calls:52000,ai_mode:12000,ai_firewall:1500}}));
  expect(await cli(['usage'],io,KEY)).toBe(0);expect(out[0]).toBe('84,500 of 150,000 credits left (+2,000 extra)');expect(out[1]).toContain('AI Firewall 1,500');expect(out[2]).toContain('2026-12-01');});
});

describe('helpers and removed commands',()=>{
 it('plainRequest needs more than one word or a quoted phrase',()=>{expect(plainRequest(['hello'])).toBeNull();expect(plainRequest(['hello there'])).toBe('hello there');expect(plainRequest(['list','apis','--model','fast'])).toBe('list apis');});
 it('usageLine summarises calls, tokens and credits',()=>{expect(usageLine(usage)).toBe('1 API call · 1,520 in / 310 out tokens (google/gemini-3.1-flash-lite) · 34 credits');expect(usageLine({...usage,input_tokens:0,output_tokens:0,api_calls:2,total_credits:26})).toBe('2 API calls · 26 credits');});
 it('removed commands explain what changed and never call the server',async()=>{const calls=server(()=>Response.json({}));for(const command of ['subkey','inbox','keys','secrets','setup']){const {io,err}=fixture();expect(await cli([command],io,KEY)).toBe(64);expect(err.join()).toContain('removed in 0.5');}expect(calls).toHaveLength(0);});
});
