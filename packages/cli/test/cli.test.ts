import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {cli,deviceName,VERSION,type CliIO} from '../src/core';
afterEach(()=>vi.unstubAllGlobals());
const KEY='opk_live_'+'a'.repeat(64);
const ID='10000000-0000-4000-8000-000000000001';
function fixture(saved:string|null=null){let stored=saved;const out:string[]=[];const err:string[]=[];const io:CliIO={hostname:'MacBook.local',out:t=>out.push(t),err:t=>err.push(t),read:async()=>stored,save:vi.fn(async(v:string)=>{stored=v;}),clear:vi.fn(async()=>{stored=null;}),open:vi.fn(),run:vi.fn(async()=>7)};return {io,out,err,stored:()=>stored};}
type Call={url:string;init:RequestInit};
function server(handler:(url:string,init:RequestInit)=>Response){const calls:Call[]=[];vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});return handler(url,init);});return calls;}
const body=(c:Call|undefined)=>JSON.parse(String(c?.init.body));
const start={device_code:'dev_1',user_code:'ABCD-EFGH',verification_uri:'https://opikey.ai/cli/activate',interval:0,expires_in:60};

describe('opi login',()=>{
 it('asks for an OPI Key named after the computer, saves it and never prints it',async()=>{const {io,out,err,stored}=fixture();let polls=0;
  const calls=server(url=>url.endsWith('/device/start')?Response.json(start):++polls===1?Response.json({error:{code:'authorization_pending'}},{status:400}):Response.json({opi_key:KEY,key_id:ID,key_name:'CLI on MacBook'}));
  expect(await cli(['login'],io,{},fetch)).toBe(0);
  expect(body(calls[0])).toEqual({device_name:'CLI on MacBook',grant:'opi_key'});expect(io.open).toHaveBeenCalledWith('https://opikey.ai/cli/activate');
  expect(stored()).toBe(KEY);expect([...out,...err].join('\n')).not.toContain(KEY);expect(out.join('\n')).toContain('Created the OPI Key "CLI on MacBook"');});
 it('refuses a verification page on another site',async()=>{const {io}=fixture();server(()=>Response.json({...start,verification_uri:'https://evil.example/cli/activate'}));await expect(cli(['login'],io,{},fetch)).rejects.toThrow('Invalid verification page');});
 it('saves nothing when denied',async()=>{const {io,err,stored}=fixture();server(url=>url.endsWith('/device/start')?Response.json(start):Response.json({error:{code:'access_denied'}},{status:400}));expect(await cli(['login'],io,{},fetch)).toBe(1);expect(stored()).toBeNull();expect(err.join()).toContain('No key was created');});
 it('rejects an old-style session or a malformed key',async()=>{for(const reply of [{access_token:'opc_session'},{opi_key:'not-a-key'}]){const {io,stored}=fixture();server(url=>url.endsWith('/device/start')?Response.json(start):Response.json(reply));expect(await cli(['login'],io,{},fetch)).toBe(1);expect(stored()).toBeNull();}});
 it('names keys safely',()=>{expect(deviceName('MacBook.local')).toBe('CLI on MacBook');expect(deviceName('')).toBe('CLI on this computer');expect(deviceName('<script>')).toBe('CLI on script');});
});

describe('opi logout',()=>{
 it('revokes the saved key with the key itself, then forgets it',async()=>{const {io,out,stored}=fixture(KEY);const calls=server(()=>Response.json({revoked:true}));expect(await cli(['logout'],io,{})).toBe(0);expect(calls[0]?.url).toBe('https://opikey.ai/api/public/v1/key/revoke');expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);expect(stored()).toBeNull();expect(out.join()).toContain('revoked');});
 it('treats an already-revoked key as signed out',async()=>{const {io,stored}=fixture(KEY);server(()=>Response.json({error:{code:'invalid_key'}},{status:401}));expect(await cli(['logout'],io,{})).toBe(0);expect(stored()).toBeNull();});
 it('never revokes a key from OPIKEY_KEY',async()=>{const {io,err}=fixture();const calls=server(()=>Response.json({}));expect(await cli(['logout'],io,{OPIKEY_KEY:KEY})).toBe(0);expect(calls).toHaveLength(0);expect(err.join()).toContain('OPIKEY_KEY is still set');});
 it('still forgets the key when revoking fails',async()=>{const {io,err,stored}=fixture(KEY);server(()=>Response.json({error:{code:'rate_limited'}},{status:429}));expect(await cli(['logout'],io,{})).toBe(1);expect(stored()).toBeNull();expect(err.join()).toContain('revoke it on the OPI Keys page');});
});

describe('which key is used',()=>{
 it('prefers OPIKEY_KEY over the saved key, and reports the source',async()=>{const {io,out}=fixture('opk_live_'+'b'.repeat(64));const calls=server(()=>Response.json({id:ID,name:'CI',prefix:'opk_live_aaaa',access:'selected',apis:['openai'],firewall_level:'strict',ai_writes:'preview',expires_at:null}));
  expect(await cli(['whoami'],io,{OPIKEY_KEY:KEY})).toBe(0);expect(calls[0]?.url).toBe('https://opikey.ai/api/public/v1/key');expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
  expect(out).toEqual(['CI\topk_live_aaaa…','from\tthe OPIKEY_KEY environment variable','APIs\topenai','firewall\tstrict','AI writes\tpreview','expires\tnever']);});
 it('uses the key from opi login when no variable is set',async()=>{const {io}=fixture(KEY);const calls=server(()=>Response.json({secrets:[{name:'openai',service:'OpenAI',environment:'production',gateway_ready:true}]}));await cli(['apis'],io,{});expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);});
 it('ignores a session token saved by an older CLI and says how to fix it',async()=>{const {io,err}=fixture('opc_old_session');const calls=server(()=>Response.json({}));expect(await cli(['usage'],io,{})).toBe(64);expect(calls).toHaveLength(0);expect(err.join('\n')).toContain('older version of the CLI');});
});

describe('opi apis and opi run',()=>{
 it('lists API names only',async()=>{const {io,out}=fixture();server(()=>Response.json({secrets:[{name:'openai',service:'OpenAI',environment:'production',gateway_ready:true},{name:'db',service:'Postgres',environment:'production',gateway_ready:false}]}));await cli(['vault'],io,{OPIKEY_KEY:KEY});expect(out).toEqual(['openai\tOpenAI\tproduction','db\tPostgres\tproduction\t(no base URL: fetch mode only)']);});
 it('runs with values only in the child environment, without the OPI Key, and never prints them',async()=>{const {io,out,err}=fixture(KEY);server(()=>Response.json({secrets:{API_TOKEN:'synthetic-private-fixture','httpbin-test':'b'}}));
  expect(await cli(['run','--','program','arg'],io,{PATH:'/bin',OPIKEY_KEY:KEY,OPIKEY_BASE_URL:'https://opikey.ai'})).toBe(7);
  expect(io.run).toHaveBeenCalledWith('program',['arg'],{PATH:'/bin',API_TOKEN:'synthetic-private-fixture',HTTPBIN_TEST:'b'});expect([...out,...err].join('\n')).not.toContain('synthetic-private-fixture');});
 it('tells users of the old --key NAME option what changed',async()=>{const {io,err}=fixture(KEY);expect(await cli(['run','--key','agent','--','x'],io,{})).toBe(64);expect(err.join()).toContain('no longer takes --key');});
});

describe('version',()=>{it('prints the package version for opi --version',async()=>{const {io,out}=fixture();expect(await cli(['--version'],io,{})).toBe(0);expect(out).toEqual([JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version]);expect(VERSION).toBe(out[0]);});});
