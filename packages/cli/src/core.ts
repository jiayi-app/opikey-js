import {OpiKey,OpiError,secureBaseUrl,checkResponse,envEntries,type AiResult,type AiModel,type HttpMethod,type Usage} from '@opikey/sdk';
import {CLIENTS,isClient,mergeJsonConfig,mergeCodexToml,clientCommand,defaultKeyName,ConfigError,SERVER_NAME} from './setup.js';
export type CliIO={out:(text:string)=>void;err:(text:string)=>void;read:()=>Promise<string|null>;save:(token:string)=>Promise<void>;clear:()=>Promise<void>;open:(url:string)=>void;run:(command:string,args:string[],env:Record<string,string|undefined>)=>Promise<number>;signal?:AbortSignal;
 /** Asks a question on the terminal and returns the typed answer, or null when there is no interactive terminal. */
 prompt?:(question:string)=>Promise<string|null>;
 /** Used by `opi setup` only. */
 setup?:{hostname:string;path:(...parts:string[])=>string;readText:(path:string)=>Promise<string|null>;writePrivate:(path:string,text:string)=>Promise<void>;exec:(command:string,args:string[])=>Promise<number>}};

const HELP=`OPIKey CLI: AI-native API Gateway. Commands work as \`opi\` or \`opikey\`.

With your OPI Key in the OPIKEY_KEY environment variable:
  opi "PLAIN-LANGUAGE REQUEST"     AI mode: OPIKey's AI makes the API calls and prints the result
  opi ai "REQUEST" [--model fast|smart] [--confirm ID]
  opi call API METHOD PATH [--data JSON]
                                   exact call through the gateway, e.g. opi call openai GET /v1/models
  opi usage                        this month's credits: left, used and where they went
  opi run -- COMMAND               run a program with your granted secrets in its environment (fetch mode)

Signed in as you (opi login):
  opi login | logout
  opi keys                         your OPI Keys (names and prefixes only)
  opi vault                        names of the APIs in your Vault (never values)
  opi secrets --key NAME           secrets a key can use (names only)
  opi run --key NAME -- COMMAND    run a program with that key's secrets
  opi setup --client CLIENT [--secrets a,b | --all-secrets] [--name N] [--expires-days N]
                                   create an OPI Key for an agent and add it to the agent's MCP settings
                                   CLIENT: ${Object.keys(CLIENTS).join(' | ')}

Your OPI Key is read from OPIKEY_KEY (or OPIKEY), never from an argument, so it stays out of your shell history.`;

/** Value after a flag, or undefined. A flag never consumes another flag or anything after "--". */
function flag(args:string[],name:string){const end=args.indexOf('--');const i=args.indexOf(name);if(i<0||(end>=0&&i>end))return undefined;const v=args[i+1];return v===undefined||v.startsWith('--')?undefined:v;}
function has(args:string[],name:string){const end=args.indexOf('--');const i=args.indexOf(name);return i>=0&&(end<0||i<end);}
function int(args:string[],name:string,min=0){const v=flag(args,name);if(v===undefined)return undefined;if(!/^\d+$/.test(v)||Number(v)<min)throw new UsageError(`${name} must be a whole number${min?` of at least ${min}`:''}.`);return Number(v);}
function list(args:string[],name:string){const v=flag(args,name);return v===undefined?undefined:v.split(',').map(s=>s.trim()).filter(Boolean);}
class UsageError extends Error{}
class SignInRequired extends Error{}
/** Kept in step with package.json by a test. */
export const VERSION='0.5.0';
const COMMANDS=new Set(['login','logout','keys','vault','secrets','run','setup','ai','call','usage','credits','help','--help','-h','version','--version','-v']);
const METHODS=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const n=(value:number)=>value.toLocaleString('en-US');

/** One line about what a request used, for stderr. */
export function usageLine(u:Usage|null|undefined){if(!u)return '';const parts=[`${n(u.api_calls)} API call${u.api_calls===1?'':'s'}`];if(u.input_tokens||u.output_tokens)parts.push(`${n(u.input_tokens)} in / ${n(u.output_tokens)} out tokens${u.model?` (${u.model})`:''}`);parts.push(`${n(u.total_credits)} credits`);return parts.join(' · ');}

/**
 * The text of a plain-language request: everything before the first flag.
 * A single unknown word is treated as a typo, not as an AI request, so a mistyped command never spends credits.
 */
export function plainRequest(args:string[]){const end=args.findIndex(a=>a.startsWith('--'));const words=(end<0?args:args.slice(0,end));const text=words.join(' ').trim();return words.length>1||/\s/.test(words[0]??'')?text:null;}

export async function cli(args:string[],io:CliIO,environment:Record<string,string|undefined>,send:typeof fetch=fetch):Promise<number>{
 const base=secureBaseUrl(environment['OPIKEY_BASE_URL']??'https://opikey.ai');const command=args[0];
 async function sessionRequest(path:string,init:RequestInit={}){const token=await io.read();if(!token)throw new SignInRequired();const headers=new Headers(init.headers);headers.set('authorization',`Bearer ${token}`);const response=await send(base+path,{...init,headers,redirect:'manual'});const next=response.headers.get('x-opi-cli-token');if(next)await io.save(next);return checkResponse(response);}
 const keyFromEnv=()=>environment['OPIKEY_KEY']||environment['OPIKEY']||'';
 /** Commands that act with an OPI Key read it from the environment, never from an argument (which would end up in shell history). */
 function keyClient(){const key=keyFromEnv();if(!key)throw new UsageError('Set the OPIKEY_KEY environment variable to your OPI Key for this command.');return new OpiKey({key,baseUrl:base});}

 /** AI mode, with a typed confirmation before any previewed write runs. */
 async function ai(input:string,rest:string[]):Promise<number>{
  if(!input||input.length>4000)throw new UsageError('Give a plain-language request of 1–4,000 characters, in quotes.');
  const model=flag(rest,'--model');if(model!==undefined&&model!=='fast'&&model!=='smart')throw new UsageError('--model must be fast or smart.');
  const opi=keyClient();const options={...(model?{model:model as AiModel}:{}),...(io.signal?{signal:io.signal}:{})};
  const confirm=flag(rest,'--confirm');
  let result:AiResult=await opi.ai(input,{...options,...(confirm?{confirmId:confirm}:{})});
  if(result.status==='needs_confirmation'){
   io.err(`This needs your confirmation${result.reason?`: ${result.reason}`:'.'}`);
   for(const c of result.planned_calls??[])io.err(`  ${c.method} ${c.api}${c.path}`);
   io.err(usageLine(result.usage));
   const id=result.confirm_id;
   const answer=id&&io.prompt?await io.prompt('Type "yes" to run these calls: '):null;
   if(!id||answer===null){io.out(id??'');io.err(id?`Nothing was run. To go ahead, run the same request again with --confirm ${id} (works once, for 15 minutes).`:'Nothing was run.');return 2;}
   if(answer.trim().toLowerCase()!=='yes'){io.err('Nothing was run.');return 2;}
   result=await opi.ai(input,{...options,confirmId:id});
  }
  if(result.status==='blocked'){io.err(`Blocked by the AI Firewall${result.reason?`: ${result.reason}`:'.'}`);const line=usageLine(result.usage);if(line)io.err(line);return 1;}
  if(result.status==='needs_confirmation'){io.err('The request still needs confirmation. Nothing more was run.');return 2;}
  io.out(result.result);
  for(const c of result.calls)io.err(`  ${c.method} ${c.api}${c.path} → ${c.status}`);
  const line=usageLine(result.usage);if(line)io.err(line);
  return 0;
 }

 /** Create an OPI Key for this agent with the signed-in session, connect it to the agent's MCP config, and verify it. Never prints the key. */
 async function setup():Promise<number>{
  const io2=io.setup;if(!io2)throw new UsageError('opi setup is not available in this environment.');
  const client=flag(args,'--client');if(!isClient(client))throw new UsageError(`opi setup --client ${Object.keys(CLIENTS).join('|')} [--secrets a,b | --all-secrets]`);
  const secrets=list(args,'--secrets');const all=has(args,'--all-secrets');if(secrets&&all)throw new UsageError('Use either --secrets or --all-secrets, not both.');
  const days=int(args,'--expires-days',1)??90;if(days>365)throw new UsageError('--expires-days must be 365 or less.');
  const name=(flag(args,'--name')??defaultKeyName(client,io2.hostname)).slice(0,80);
  const response=await sessionRequest('/api/public/cli/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,client,expires_in_days:days,...(all?{secrets:'all'}:secrets?{secrets}:{})})});
  const created=await response.json() as {id:string;name:string;key:string;expires_at:string|null;secrets:string[]};
  const url=base+'/api/public/mcp';const key=created.key;
  let installed:string|null=null;let replaced=false;let problem:string|null=null;
  const spec=CLIENTS[client];
  try{
   if(spec.kind==='json'){const path=io2.path(...spec.path);const r=mergeJsonConfig(await io2.readText(path),spec.urlField,url,key);await io2.writePrivate(path,r.text);installed=path;replaced=r.replaced;}
   else if(spec.kind==='toml'){const path=io2.path(...spec.path);const r=mergeCodexToml(await io2.readText(path),url,key);await io2.writePrivate(path,r.text);installed=path;replaced=r.replaced;}
   else if(spec.kind==='command'){const c=clientCommand(client as 'claude-code'|'vscode',url,key);if(c.remove)await io2.exec(c.remove.command,c.remove.args).catch(()=>1);const code=await io2.exec(c.command,c.args);if(code!==0)throw new ConfigError(`The ${c.command} command was not found or failed (exit ${code}).`);installed=`${spec.label} MCP settings`;}
  }catch(error){problem=error instanceof ConfigError?error.message:'The MCP config could not be written.';}
  if(!installed){
   // Never lose the key: keep it in a private file the human can use to finish by hand.
   const path=io2.path('.config','opikey','agent.env');await io2.writePrivate(path,`OPIKEY_KEY=${key}\n`);
   if(problem)io.err(`Could not connect ${spec.label} automatically: ${problem}`);
   io.err(`The key was saved to ${path} (readable only by you). Add an MCP server named "${SERVER_NAME}" with URL ${url} and the header "Authorization: Bearer <the OPIKEY_KEY value from that file>".`);
  }
  let verified=false;try{await new OpiKey({key,baseUrl:base}).usage();verified=true;}catch{verified=false;}
  io.out(`Key\t${created.name}`);io.out(`Expires\t${created.expires_at??'never'}`);io.out(`APIs\t${created.secrets.length?created.secrets.join(', '):'none yet: choose APIs on the key page in OPIKey'}`);
  io.out(`MCP\t${installed?`connected in ${installed}${replaced?' (replaced an older opikey entry)':''}`:'not connected automatically'}`);io.out(`Verified\t${verified?'yes':'no'}`);
  if(replaced)io.err('An older "opikey" entry was replaced. If its key is no longer used, revoke it on the OPI Keys page.');
  if(installed)io.err(`Reload MCP servers in ${spec.label}, then ask the opikey "opi" tool what you need in plain language.`);
  return installed&&verified?0:1;
 }

 if(command==='--version'||command==='-v'||command==='version'){io.out(VERSION);return 0;}
 if(command===undefined||command==='help'||command==='--help'||command==='-h'){io.out(HELP);return 0;}
 try{
 if(command==='login'){const response=await checkResponse(await send(base+'/api/public/cli/device/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device_name:environment['OPIKEY_DEVICE_NAME']??'OPI CLI'}),redirect:'manual'}));const data=await response.json() as {device_code:string;user_code:string;verification_uri:string;interval:number;expires_in:number};const verify=new URL(data.verification_uri);if(verify.origin!==base||verify.pathname!=='/cli/activate')throw new Error('Invalid verification page.');io.out(`Open ${verify.href}\nEnter ${data.user_code}`);io.open(verify.href);const deadline=Date.now()+data.expires_in*1000;let interval=data.interval*1000;
  while(Date.now()<deadline){await new Promise(r=>setTimeout(r,interval));const result=await send(base+'/api/public/cli/device/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device_code:data.device_code}),redirect:'manual'});const body=await result.json() as {access_token?:string;error?:{code?:string}};if(result.ok&&body.access_token){await io.save(body.access_token);io.out('Signed in.');return 0;}const code=body.error?.code;if(code==='slow_down'){interval+=5000;continue;}if(code==='authorization_pending')continue;io.err(code==='access_denied'?'Device denied.':'Device authorization expired.');return 1;}io.err('Device authorization expired.');return 1;
 }
 if(command==='logout'){try{await sessionRequest('/api/public/cli/logout',{method:'POST'});}finally{await io.clear();}io.out('Signed out.');return 0;}
 if(command==='keys'){const response=await sessionRequest('/api/public/cli/keys');const data=await response.json() as {keys:{id:string;name:string;key_prefix:string;modes:string[];revoked_at:string|null}[]};for(const key of data.keys)io.out(`${key.name}\t${key.key_prefix}\t${key.modes.join(',')}\t${key.revoked_at?'revoked':'active'}`);return 0;}
 if(command==='vault'){const response=await sessionRequest('/api/public/cli/vault');const data=await response.json() as {secrets:{name:string;service:string;environment:string;gateway_ready:boolean}[]};if(!data.secrets.length)io.err('No APIs saved yet. Add them in OPIKey under Vault.');for(const secret of data.secrets)io.out(`${secret.name}\t${secret.service}\t${secret.environment}${secret.gateway_ready?'':'\t(no base URL: fetch mode only)'}`);return 0;}
 if(command==='setup')return await setup();
 const ref=flag(args,'--key');
 if(command==='secrets'){if(!ref)throw new UsageError('Choose an OPI Key with --key NAME.');const response=await sessionRequest('/api/public/cli/secrets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:ref})});const data=await response.json() as {secrets:{name:string;service:string;environment:string}[]};for(const secret of data.secrets)io.out(`${secret.name}\t${secret.service}\t${secret.environment}`);return 0;}

 if(command==='run'){const separator=args.indexOf('--');const executable=separator>=0?args[separator+1]:undefined;if(!executable)throw new UsageError('Provide a command after --.');const childEnv={...environment};delete childEnv['OPIKEY'];delete childEnv['OPIKEY_KEY'];delete childEnv['OPIKEY_BASE_URL'];const childArgs=args.slice(separator+2);
  if(keyFromEnv()){await keyClient().loadSecrets({target:childEnv});}
  else{if(!ref)throw new UsageError('Choose an OPI Key with --key NAME, or set OPIKEY_KEY.');const response=await sessionRequest('/api/public/cli/run-secrets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:ref})});const data=await response.json() as {secrets:Record<string,unknown>};for(const {env:name,value}of envEntries(data.secrets))childEnv[name]=value;}
  return io.run(executable,childArgs,childEnv);}

 if(command==='ai'){const end=args.findIndex((a,i)=>i>0&&a.startsWith('--'));const input=args.slice(1,end<0?undefined:end).join(' ').trim();if(!input)throw new UsageError('opi ai "PLAIN-LANGUAGE REQUEST"');return await ai(input,args.slice(1));}

 if(command==='call'){const [api,methodRaw,path]=[args[1],args[2],args[3]];const method=methodRaw?.toUpperCase();
  if(!api||!method||!path||!METHODS.has(method)||!path.startsWith('/'))throw new UsageError('opi call API METHOD PATH [--data JSON], e.g. opi call openai GET /v1/models');
  const raw=flag(args,'--data');let data:unknown;if(raw!==undefined){try{data=JSON.parse(raw);}catch{throw new UsageError('--data must be valid JSON.');}}
  const r=await keyClient().call({api,method:method as HttpMethod,path,...(data!==undefined?{body:data}:{}),...(io.signal?{signal:io.signal}:{})});
  const text=await r.response.text();if(text)io.out(text);
  const parts=[String(r.status)];if(r.check?.verdict)parts.push(r.check.verdict);if(r.creditsCharged!==null)parts.push(`${n(r.creditsCharged)} credits`);io.err(parts.join(' · '));
  return r.ok?0:1;}

 if(command==='usage'||command==='credits'){const u=await keyClient().usage();
  io.out(`${n(u.credits_left)} of ${n(u.credits_included)} credits left${u.extra_credits_left?` (+${n(u.extra_credits_left)} extra)`:''}`);
  io.out(`used\t${n(u.credits_used)}\t(API calls ${n(u.breakdown.api_calls)} · AI mode ${n(u.breakdown.ai_mode)} · AI Firewall ${n(u.breakdown.ai_firewall)})`);
  io.out(`resets\t${u.resets_at??'—'}`);return 0;}

 const request=COMMANDS.has(command)?null:plainRequest(args);
 if(request)return await ai(request,args);
 io.err(`Unknown command "${command}". To ask in plain language, put the request in quotes: opi "what can you do?"`);io.out(HELP);return 64;
 }catch(error){
  if(error instanceof UsageError){io.err(error.message);return 64;}
  if(error instanceof SignInRequired){io.err('Not signed in. Run opi login first.');return 1;}
  if(error instanceof OpiError){io.err(`${error.message} (${error.code})`);return 1;}
  throw error;
 }
}
