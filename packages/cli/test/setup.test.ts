import {afterEach,describe,expect,it,vi} from 'vitest';
import {cli,type CliIO} from '../src/core';
import {mergeJsonConfig,mergeCodexToml,clientCommand,defaultKeyName} from '../src/setup';
afterEach(()=>vi.unstubAllGlobals());
const ID='10000000-0000-4000-8000-000000000001';
const KEY='opk_live_'+'a'.repeat(64);
function fixture(files:Record<string,string>={},execCode=0){
 const out:string[]=[];const err:string[]=[];const written:Record<string,string>={};const execs:{command:string;args:string[]}[]=[];
 const io:CliIO={out:t=>out.push(t),err:t=>err.push(t),read:async()=>'opc_synthetic',save:async()=>undefined,clear:async()=>undefined,open:()=>undefined,run:vi.fn(async()=>0),
  setup:{hostname:'MacBook.local',path:(...p)=>'/home/u/'+p.join('/'),readText:async p=>files[p]??null,writePrivate:async(p,t)=>{written[p]=t;},exec:async(command,args)=>{execs.push({command,args});return execCode;}}};
 return {io,out,err,written,execs};}
type Call={url:string;init:RequestInit};
function server(self=true){const calls:Call[]=[];vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});if(url.endsWith('/api/public/cli/keys'))return Response.json({id:ID,name:'Cursor on MacBook',key:KEY,expires_at:'2027-02-23T00:00:00Z',secrets:['openai']},{status:201,headers:{'x-opi-cli-token':'opc_next'}});if(url.endsWith('/keys/self'))return self?Response.json({id:ID,chain:[{id:ID,name:'Cursor on MacBook'}]}):Response.json({error:{code:'invalid_key'}},{status:401});return Response.json({});});return calls;}

describe('config merging',()=>{
 it('adds opikey to a JSON config and keeps other servers and settings',()=>{const r=mergeJsonConfig(JSON.stringify({theme:'dark',mcpServers:{github:{url:'https://x'}}}),'url','https://opikey.ai/api/public/mcp',KEY);const d=JSON.parse(r.text);expect(d.theme).toBe('dark');expect(d.mcpServers.github).toEqual({url:'https://x'});expect(d.mcpServers.opikey).toEqual({url:'https://opikey.ai/api/public/mcp',headers:{Authorization:`Bearer ${KEY}`}});expect(r.replaced).toBe(false);});
 it('replaces an existing opikey entry and reports it',()=>{expect(mergeJsonConfig(JSON.stringify({mcpServers:{opikey:{url:'old'}}}),'serverUrl','u',KEY).replaced).toBe(true);});
 it('refuses to rewrite a file it cannot parse',()=>{expect(()=>mergeJsonConfig('{ // comment\n}','url','u',KEY)).toThrow(/left unchanged/);});
 it('replaces only the opikey table in Codex config.toml',()=>{const existing='model = "o5"\n\n[mcp_servers.github]\nurl = "https://gh"\n\n[mcp_servers.opikey]\nurl = "old"\nhttp_headers = { "Authorization" = "Bearer old" }\n\n[profiles.fast]\nmodel = "mini"\n';const r=mergeCodexToml(existing,'https://opikey.ai/api/public/mcp',KEY);expect(r.replaced).toBe(true);expect(r.text).toContain('[mcp_servers.github]\nurl = "https://gh"');expect(r.text).toContain('[profiles.fast]\nmodel = "mini"');expect(r.text).not.toContain('Bearer old');expect(r.text.match(/\[mcp_servers\.opikey\]/g)).toHaveLength(1);expect(r.text).toContain(`http_headers = { "Authorization" = "Bearer ${KEY}" }`);});
 it('builds client commands with the key as a single argument, no shell',()=>{const c=clientCommand('claude-code','https://opikey.ai/api/public/mcp',KEY);expect(c.command).toBe('claude');expect(c.args).toContain(`Authorization: Bearer ${KEY}`);expect(c.remove?.args).toEqual(['mcp','remove','--scope','user','opikey']);expect(JSON.parse(clientCommand('vscode','u',KEY).args[1]??'')).toMatchObject({name:'opikey',type:'http'});});
 it('names the key after the client and computer',()=>{expect(defaultKeyName('claude-code','MacBook.local')).toBe('Claude Code on MacBook');});
});

describe('opi setup',()=>{
 it('creates a key with the session, writes it into Cursor config, verifies it and never prints it',async()=>{const calls=server();const {io,out,err,written}=fixture({'/home/u/.cursor/mcp.json':JSON.stringify({mcpServers:{other:{url:'x'}}})});
  expect(await cli(['setup','--client','cursor','--secrets','openai'],io,{})).toBe(0);
  const create=calls.find(c=>c.url.endsWith('/api/public/cli/keys'));expect(new Headers(create?.init.headers).get('authorization')).toBe('Bearer opc_synthetic');expect(JSON.parse(String(create?.init.body))).toEqual({name:'Cursor on MacBook',client:'cursor',expires_in_days:90,allow_subkeys:true,secrets:['openai']});
  expect(JSON.parse(written['/home/u/.cursor/mcp.json']??'').mcpServers).toMatchObject({other:{url:'x'},opikey:{url:'https://opikey.ai/api/public/mcp'}});
  expect(new Headers(calls.find(c=>c.url.endsWith('/keys/self'))?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
  expect([...out,...err].join('\n')).not.toContain(KEY);expect(out).toContain('Verified\tyes');});
 it('uses the claude command for Claude Code, removing an old entry first',async()=>{server();const {io,execs}=fixture();expect(await cli(['setup','--client','claude-code','--all-secrets'],io,{})).toBe(0);expect(execs.map(e=>e.args.slice(0,2).join(' '))).toEqual(['mcp remove','mcp add']);});
 it('saves the key to a private file and exits 1 when the client cannot be configured',async()=>{server();const {io,err,written}=fixture({},127);expect(await cli(['setup','--client','vscode'],io,{})).toBe(1);expect(written['/home/u/.config/opikey/agent.env']).toBe(`OPIKEY=${KEY}\n`);expect(err.join('\n')).toContain('agent.env');expect(err.join('\n')).not.toContain(KEY);});
 it('leaves an unparseable config untouched and falls back to the private file',async()=>{server();const {io,written}=fixture({'/home/u/.gemini/settings.json':'{ // jsonc\n}'});expect(await cli(['setup','--client','gemini'],io,{})).toBe(1);expect(written['/home/u/.gemini/settings.json']).toBeUndefined();expect(written['/home/u/.config/opikey/agent.env']).toBeDefined();});
 it('reports when the new key cannot be verified',async()=>{server(false);const {io,out}=fixture();expect(await cli(['setup','--client','windsurf'],io,{})).toBe(1);expect(out).toContain('Verified\tno');});
 it('validates options before creating anything',async()=>{const calls=server();const {io}=fixture();expect(await cli(['setup','--client','notepad'],io,{})).toBe(64);expect(await cli(['setup','--client','cursor','--secrets','a','--all-secrets'],io,{})).toBe(64);expect(await cli(['setup','--client','cursor','--expires-days','999'],io,{})).toBe(64);expect(calls).toHaveLength(0);});
 it('opi vault lists names only',async()=>{vi.stubGlobal('fetch',async()=>Response.json({secrets:[{name:'openai',service:'OpenAI',environment:'production',gateway_ready:true},{name:'db',service:'Postgres',environment:'production',gateway_ready:false}]}));const {io,out}=fixture();await cli(['vault'],io,{});expect(out).toEqual(['openai\tOpenAI\tproduction','db\tPostgres\tproduction\t(no base URL: fetch mode only)']);});
});
import {readFileSync} from 'node:fs';
import {VERSION} from '../src/core';
describe('version',()=>{it('prints the package version for opi --version',async()=>{const {io,out}=fixture();expect(await cli(['--version'],io,{})).toBe(0);expect(out).toEqual([JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version]);expect(VERSION).toBe(out[0]);});});
