import {afterEach,describe,expect,it,vi} from 'vitest';
import {cli,type CliIO} from '../src/core';
import {parseEnv,pickSecrets,detectService,mask,removeFromEnv} from '../src/envfile';
import {SKILL_MD} from '../src/skill';
afterEach(()=>vi.unstubAllGlobals());
const KEY={OPIKEY_KEY:'synthetic-key'};
type Call={url:string;init:RequestInit};
function server(handler:(url:string,init:RequestInit)=>Response){const calls:Call[]=[];vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});return handler(url,init);});return calls;}
const body=(c:Call|undefined)=>JSON.parse(String(c?.init.body));
function fixture(disk:Record<string,string>,answer?:string|null){const out:string[]=[];const err:string[]=[];const written:Record<string,string>={};
 const io:CliIO={out:t=>out.push(t),err:t=>err.push(t),read:async()=>null,save:async()=>undefined,clear:async()=>undefined,open:()=>undefined,run:vi.fn(async()=>0),
  ...(answer!==undefined?{prompt:vi.fn(async()=>answer)}:{}),
  files:{cwd:'/app',home:'/home/me',join:(...p)=>p.join('/'),read:async p=>disk[p]??null,write:async(p,t)=>{written[p]=t;}}};
 return {io,out,err,written};}
const ENV=`# my app
NODE_ENV=development
PORT=3000
export OPENAI_API_KEY="sk-proj-abcdefghijklmnop"
STRIPE_SECRET_KEY=sk_test_1234567890abcdef # test mode
NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co
OPIKEY_KEY=opk_synthetic_key
RESEND_API_KEY='re_123456789abc'
DEBUG=true
DATABASE_URL=postgres://user:pass@db.example.com:5432/app
`;

describe('.env parsing',()=>{
 it('finds API keys and skips config, public and OPIKey values',()=>{const {secrets,skipped}=pickSecrets(parseEnv(ENV));
  expect(secrets.map(s=>[s.name,s.service])).toEqual([['OPENAI_API_KEY','openai'],['STRIPE_SECRET_KEY','stripe'],['RESEND_API_KEY','resend'],['DATABASE_URL',undefined]]);
  expect(secrets[1]?.value).toBe('sk_test_1234567890abcdef');expect(secrets[2]?.value).toBe('re_123456789abc');
  expect(skipped.map(s=>s.name)).toEqual(expect.arrayContaining(['NODE_ENV','PORT','NEXT_PUBLIC_SUPABASE_URL','OPIKEY_KEY','DEBUG']));});
 it('detects services from value prefixes',()=>{expect(detectService('X','sk-ant-abc')).toBe('anthropic');expect(detectService('X','ghp_abc')).toBe('github');expect(detectService('X','gsk_abc')).toBe('groq');});
 it('masks values and removes imported lines',()=>{expect(mask('sk-proj-abcdef')).toBe('sk-p••••');const entries=parseEnv(ENV);const out=removeFromEnv(ENV,entries,new Set(['OPENAI_API_KEY']));
  expect(out).not.toContain('sk-proj-');expect(out).toContain('PORT=3000');expect(out).toContain('opi run --');});
});

describe('opi import',()=>{
 const ok=()=>Response.json({imported:[{name:'OPENAI_API_KEY',service:'openai',gateway_ready:true},{name:'STRIPE_SECRET_KEY',service:'stripe',gateway_ready:true},{name:'DATABASE_URL',service:null,gateway_ready:false}],skipped:[{name:'RESEND_API_KEY',reason:'exists'}]});
 it('shows masked names, asks for "yes", imports and never prints a value',async()=>{const {io,out,err}=fixture({'/app/.env':ENV},'yes');const calls=server(ok);
  expect(await cli(['import'],io,KEY)).toBe(0);
  expect(calls[0]?.url).toBe('https://opikey.ai/api/public/v1/vault/import');expect(body(calls[0]).on_conflict).toBe('skip');expect(body(calls[0]).secrets).toHaveLength(4);
  const printed=[...out,...err].join('\n');expect(printed).not.toContain('sk-proj-abcdefghijklmnop');expect(printed).not.toContain('pass@');expect(printed).toContain('OPENAI_API_KEY');
  expect(out).toContain('imported\tOPENAI_API_KEY\topenai');expect(out.join('\n')).toContain('already in your Vault');});
 it('imports nothing when the answer is not "yes", or with no terminal and no --yes',async()=>{const calls=server(ok);
  expect(await cli(['import'],fixture({'/app/.env':ENV},'no').io,KEY)).toBe(2);expect(await cli(['import'],fixture({'/app/.env':ENV}).io,KEY)).toBe(2);expect(calls).toHaveLength(0);});
 it('--yes --replace --remove imports a named file and removes only imported lines',async()=>{const {io,written}=fixture({'/app/config/.env.local':ENV});const calls=server(ok);
  expect(await cli(['import','config/.env.local','--yes','--replace','--remove'],io,KEY)).toBe(0);expect(body(calls[0]).on_conflict).toBe('replace');
  const after=written['/app/config/.env.local']??'';expect(after).not.toContain('OPENAI_API_KEY=');expect(after).toContain('RESEND_API_KEY');expect(after).toContain('PORT=3000');});
 it('explains a missing file and a key without Vault write access',async()=>{const missing=fixture({});expect(await cli(['import'],missing.io,KEY)).toBe(64);expect(missing.err.join()).toContain('No file at .env');
  const {io,err}=fixture({'/app/.env':ENV});server(()=>Response.json({error:{code:'vault_write_not_allowed'}},{status:403}));expect(await cli(['import','--yes'],io,KEY)).toBe(1);expect(err.join()).toContain('vault_write_not_allowed');});
 it('sends large files in batches of 200',async()=>{const big=Array.from({length:250},(_,i)=>`SERVICE_${i}_API_KEY=sk-proj-${'x'.repeat(10)}${i}`).join('\n');const {io}=fixture({'/app/.env':big});
  const calls=server((_,init)=>Response.json({imported:JSON.parse(String(init.body)).secrets.map((s:{name:string})=>({name:s.name,service:'openai',gateway_ready:true})),skipped:[]}));
  expect(await cli(['import','--yes'],io,KEY)).toBe(0);expect(calls.map(c=>body(c).secrets.length)).toEqual([200,50]);});
});

describe('opi skill',()=>{
 it('installs the skill for each agent in its personal skills folder',async()=>{server(()=>Response.json({}));
  for(const [agent,path] of [['claude-code','/home/me/.claude/skills/opikey/SKILL.md'],['codex','/home/me/.agents/skills/opikey/SKILL.md'],['openclaw','/home/me/.openclaw/skills/opikey/SKILL.md'],['hermes','/home/me/.hermes/skills/opikey/SKILL.md']] as const){
   const {io,written,out}=fixture({});expect(await cli(['skill','install','--agent',agent],io,KEY)).toBe(0);expect(written[path]).toBe(SKILL_MD);expect(out[0]).toContain(path);}});
 it('prints the skill and rejects an unknown agent',async()=>{const {io,out}=fixture({});expect(await cli(['skill','show'],io,{})).toBe(0);expect(out[0]).toContain('name: opikey');
  const bad=fixture({});expect(await cli(['skill','install','--agent','cursor'],bad.io,{})).toBe(64);expect(Object.keys(bad.written)).toHaveLength(0);});
 it('the skill never contains a key',()=>{expect(SKILL_MD).not.toMatch(/opk_[A-Za-z0-9]{8}/);expect(SKILL_MD).toMatch(/^---\nname: opikey\ndescription: /);});
});
