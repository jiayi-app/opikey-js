import {Opi,OpiError,secureBaseUrl,checkResponse,envEntries,type SubkeyInput,type InboxSource} from '@opikey/sdk';
import {CLIENTS,isClient,mergeJsonConfig,mergeCodexToml,clientCommand,defaultKeyName,ConfigError,SERVER_NAME,type ClientId} from './setup.js';
export type CliIO={out:(text:string)=>void;err:(text:string)=>void;read:()=>Promise<string|null>;save:(token:string)=>Promise<void>;clear:()=>Promise<void>;open:(url:string)=>void;run:(command:string,args:string[],env:Record<string,string|undefined>)=>Promise<number>;signal?:AbortSignal;
 /** Used by `opi setup` only. */
 setup?:{hostname:string;path:(...parts:string[])=>string;readText:(path:string)=>Promise<string|null>;writePrivate:(path:string,text:string)=>Promise<void>;exec:(command:string,args:string[])=>Promise<number>}};

const HELP=`opi login | logout | keys | secrets --key NAME | run --key NAME -- COMMAND
  opi vault                       names of the APIs saved in your vault (never values)
  opi setup --client CLIENT [--secrets a,b | --all-secrets] [--name N] [--expires-days N] [--no-subkeys]
                                  create an OPI Key for this agent and connect it over MCP
                                  CLIENT: ${Object.keys(CLIENTS).join(' | ')}

With an OPI Key in the OPIKEY environment variable:
  opi run [--subkey [--ttl SECONDS] [--secrets a,b] [--max-calls N] [--budget CREDITS]] -- COMMAND
  opi whoami                      this key's limits, budget and chain
  opi credits                     account credit balance (root keys only)
  opi subkey create --ttl SECONDS [--name N] [--task T] [--secrets a,b] [--max-calls N] [--budget CREDITS] [--delegate] [--role R]
  opi subkey list | revoke ID | pause ID | resume ID
  opi ai "TASK" [--wait SECONDS]  AI mode; waits for your approval of writes when --wait is set
  opi inbox list
  opi inbox create --name N --source SOURCE [--generate | --secret-name NAME] [--retention DAYS]
  opi inbox listen ID [--forward URL] [--type T]`;

/** Value after a flag, or undefined. A flag never consumes another flag or anything after "--". */
function flag(args:string[],name:string){const end=args.indexOf('--');const i=args.indexOf(name);if(i<0||(end>=0&&i>end))return undefined;const v=args[i+1];return v===undefined||v.startsWith('--')?undefined:v;}
function has(args:string[],name:string){const end=args.indexOf('--');const i=args.indexOf(name);return i>=0&&(end<0||i<end);}
function int(args:string[],name:string,min=0){const v=flag(args,name);if(v===undefined)return undefined;if(!/^\d+$/.test(v)||Number(v)<min)throw new UsageError(`${name} must be a whole number${min?` of at least ${min}`:''}.`);return Number(v);}
function list(args:string[],name:string){const v=flag(args,name);return v===undefined?undefined:v.split(',').map(s=>s.trim()).filter(Boolean);}
class UsageError extends Error{}
class SignInRequired extends Error{}
/** Kept in step with package.json by a test. */
export const VERSION='0.4.0';
const SOURCES:InboxSource[]=['stripe','github','standard_webhooks','slack','generic_hmac','none'];

/** Only https URLs, or http://localhost / 127.0.0.1 for local development, may receive forwarded messages. */
export function forwardTarget(value:string){const url=new URL(value);const local=url.protocol==='http:'&&(url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]');if(url.username||url.password||!(url.protocol==='https:'||local))throw new UsageError('--forward must be https://… or http://localhost:PORT/…');return url;}

export async function cli(args:string[],io:CliIO,environment:Record<string,string|undefined>,send:typeof fetch=fetch):Promise<number>{
 const base=secureBaseUrl(environment['OPIKEY_BASE_URL']??'https://opikey.ai');const command=args[0];
 async function sessionRequest(path:string,init:RequestInit={}){const token=await io.read();if(!token)throw new SignInRequired();const headers=new Headers(init.headers);headers.set('authorization',`Bearer ${token}`);const response=await send(base+path,{...init,headers,redirect:'manual'});const next=response.headers.get('x-opi-cli-token');if(next)await io.save(next);return checkResponse(response);}
 /** Commands that act as an agent use the OPI Key from the OPIKEY environment variable, never a command-line argument (which would end up in shell history). */
 function keyClient(){const key=environment['OPIKEY'];if(!key)throw new UsageError('Set the OPIKEY environment variable to an OPI Key for this command.');return new Opi({key,baseUrl:base});}
 /** Create an OPI Key for this agent with the signed-in session, connect it to the agent's MCP config, and verify it. Never prints the key. */
 async function setup():Promise<number>{
  const io2=io.setup;if(!io2)throw new UsageError('opi setup is not available in this environment.');
  const client=flag(args,'--client');if(!isClient(client))throw new UsageError(`opi setup --client ${Object.keys(CLIENTS).join('|')} [--secrets a,b | --all-secrets]`);
  const secrets=list(args,'--secrets');const all=has(args,'--all-secrets');if(secrets&&all)throw new UsageError('Use either --secrets or --all-secrets, not both.');
  const days=int(args,'--expires-days',1)??90;if(days>365)throw new UsageError('--expires-days must be 365 or less.');
  const name=(flag(args,'--name')??defaultKeyName(client,io2.hostname)).slice(0,80);
  const response=await sessionRequest('/api/public/cli/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,client,expires_in_days:days,allow_subkeys:!has(args,'--no-subkeys'),...(all?{secrets:'all'}:secrets?{secrets}:{})})});
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
   const path=io2.path('.config','opikey','agent.env');await io2.writePrivate(path,`OPIKEY=${key}\n`);
   if(problem)io.err(`Could not connect ${spec.label} automatically: ${problem}`);
   io.err(`The key was saved to ${path} (readable only by you). Add an MCP server named "${SERVER_NAME}" with URL ${url} and the header "Authorization: Bearer <the OPIKEY value from that file>".`);
  }
  let verified=false;try{const self=await new Opi({key,baseUrl:base}).keys.self();verified=self.id===created.id;}catch{verified=false;}
  io.out(`Key\t${created.name}`);io.out(`Expires\t${created.expires_at??'never'}`);io.out(`APIs\t${created.secrets.length?created.secrets.join(', '):'none yet: tick APIs on the key page in OPIKey'}`);
  io.out(`MCP\t${installed?`connected in ${installed}${replaced?' (replaced an older opikey entry)':''}`:'not connected automatically'}`);io.out(`Verified\t${verified?'yes':'no'}`);
  if(replaced)io.err('An older "opikey" entry was replaced. If its key is no longer used, revoke it on the OPI Keys page.');
  if(installed)io.err(`Reload MCP servers in ${spec.label}, then call the opikey list_secrets tool.`);
  return installed&&verified?0:1;
 }
 if(command==='--version'||command==='-v'||command==='version'){io.out(VERSION);return 0;}
 try{
 if(command==='login'){const response=await checkResponse(await send(base+'/api/public/cli/device/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device_name:environment['OPIKEY_DEVICE_NAME']??'OPI CLI'}),redirect:'manual'}));const data=await response.json() as {device_code:string;user_code:string;verification_uri:string;interval:number;expires_in:number};const verify=new URL(data.verification_uri);if(verify.origin!==base||verify.pathname!=='/cli/activate')throw new Error('Invalid verification page.');io.out(`Open ${verify.href}\nEnter ${data.user_code}`);io.open(verify.href);const deadline=Date.now()+data.expires_in*1000;let interval=data.interval*1000;
  while(Date.now()<deadline){await new Promise(r=>setTimeout(r,interval));const result=await send(base+'/api/public/cli/device/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device_code:data.device_code}),redirect:'manual'});const body=await result.json() as {access_token?:string;error?:{code?:string}};if(result.ok&&body.access_token){await io.save(body.access_token);io.out('Signed in.');return 0;}const code=body.error?.code;if(code==='slow_down'){interval+=5000;continue;}if(code==='authorization_pending')continue;io.err(code==='access_denied'?'Device denied.':'Device authorization expired.');return 1;}io.err('Device authorization expired.');return 1;
 }
 if(command==='logout'){try{await sessionRequest('/api/public/cli/logout',{method:'POST'});}finally{await io.clear();}io.out('Signed out.');return 0;}
 if(command==='keys'){const response=await sessionRequest('/api/public/cli/keys');const data=await response.json() as {keys:{id:string;name:string;key_prefix:string;modes:string[];revoked_at:string|null}[]};for(const key of data.keys)io.out(`${key.name}\t${key.key_prefix}\t${key.modes.join(',')}\t${key.revoked_at?'revoked':'active'}`);return 0;}
 if(command==='vault'){const response=await sessionRequest('/api/public/cli/vault');const data=await response.json() as {secrets:{name:string;service:string;environment:string;gateway_ready:boolean}[]};if(!data.secrets.length)io.err('No APIs saved yet. Add them in OPIKey under API/secrets.');for(const secret of data.secrets)io.out(`${secret.name}\t${secret.service}\t${secret.environment}${secret.gateway_ready?'':'\t(no base URL: fetch mode only)'}`);return 0;}
 if(command==='setup')return await setup();
 const ref=flag(args,'--key');
 if(command==='secrets'){if(!ref)throw new UsageError('Choose an OPI Key with --key NAME.');const response=await sessionRequest('/api/public/cli/secrets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:ref})});const data=await response.json() as {secrets:{name:string;service:string;environment:string}[]};for(const secret of data.secrets)io.out(`${secret.name}\t${secret.service}\t${secret.environment}`);return 0;}

 if(command==='run'){const separator=args.indexOf('--');const executable=separator>=0?args[separator+1]:undefined;if(!executable)throw new UsageError('Provide a command after --.');const childEnv={...environment};delete childEnv['OPIKEY'];delete childEnv['OPIKEY_BASE_URL'];const childArgs=args.slice(separator+2);
  if(has(args,'--subkey')){
   // Safest mode: the program gets a short-lived, gateway-only sub-key as OPIKEY and no raw secrets. The sub-key is revoked when the program exits.
   const opi=keyClient();const input:SubkeyInput={ttl_seconds:int(args,'--ttl',60)??3600,process:true,modes:['gateway'],name:'opi run',task:executable.slice(0,200)};
   const secrets=list(args,'--secrets');if(secrets)input.secrets=secrets;const calls=int(args,'--max-calls');if(calls!==undefined)input.max_calls=calls;const budget=int(args,'--budget');if(budget!==undefined)input.budget_credits=budget;
   const child=await opi.keys.delegate(input);
   try{return await io.run(executable,childArgs,{...childEnv,OPIKEY:child.key,OPIKEY_BASE_URL:base});}
   finally{try{await opi.keys.revoke(child.id);}catch{io.err(`Could not revoke the run's sub-key ${child.id}; it expires on its own at ${child.expires_at}. Revoke it in the dashboard to be sure.`);}}
  }
  if(environment['OPIKEY']){const opi=new Opi({key:environment['OPIKEY'],baseUrl:base});await opi.loadSecrets({target:childEnv});}
  else{if(!ref)throw new UsageError('Choose an OPI Key with --key NAME, or set OPIKEY.');const response=await sessionRequest('/api/public/cli/run-secrets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:ref})});const data=await response.json() as {secrets:Record<string,unknown>};for(const {env:name,value}of envEntries(data.secrets))childEnv[name]=value;}
  return io.run(executable,childArgs,childEnv);}

 if(command==='whoami'){const s=await keyClient().keys.self();io.out(`${s.chain.map(c=>c.name).join(' › ')}`);io.out(`expires\t${s.expires_at??'never'}\npaused\t${s.paused}\nsub-keys\t${s.can_delegate?'allowed':'not allowed'}\nsecrets\t${s.secrets.join(', ')||'none'}\nmodes\t${s.modes.join(', ')}`);if(s.calls)io.out(`calls\t${s.calls.available} of ${s.calls.max} left`);if(s.budget)io.out(`credits\t${s.budget.available_credits} of ${s.budget.total_credits} left`);return 0;}
 if(command==='credits'){const c=await keyClient().credits();io.out(`${c.balance.toLocaleString('en-US')} credits\t(monthly ${c.monthly_remaining.toLocaleString('en-US')}, purchased ${c.purchased_remaining.toLocaleString('en-US')})`);return 0;}

 if(command==='subkey'){const opi=keyClient();const sub=args[1];
  if(sub==='create'){const ttl=int(args,'--ttl',60);if(ttl===undefined)throw new UsageError('opi subkey create needs --ttl SECONDS (at least 60).');const input:SubkeyInput={ttl_seconds:ttl};
   const name=flag(args,'--name');if(name)input.name=name;const task=flag(args,'--task');if(task)input.task=task;const role=flag(args,'--role');if(role)input.role=role;const secrets=list(args,'--secrets');if(secrets)input.secrets=secrets;
   const calls=int(args,'--max-calls');if(calls!==undefined)input.max_calls=calls;const budget=int(args,'--budget');if(budget!==undefined)input.budget_credits=budget;if(has(args,'--delegate'))input.can_delegate=true;
   const child=await opi.keys.delegate(input);
   // The key goes to stdout alone, so `opi subkey create … > child.env` captures only it. Everything else goes to stderr.
   io.err(`Created sub-key ${child.id}, expires ${child.expires_at}. The key below is shown once; give it only to the intended sub-agent.`);io.out(`OPIKEY=${child.key}`);return 0;}
  if(sub==='list'){for(const c of await opi.keys.children())io.out(`${c.id}\t${c.name??''}\t${c.revoked_at?'revoked':c.paused_at?'paused':c.expires_at&&Date.parse(c.expires_at)<=Date.now()?'expired':'active'}\t${c.expires_at??''}\t${c.calls_used} calls`);return 0;}
  if(sub==='revoke'||sub==='pause'||sub==='resume'){const id=args[2];if(!id)throw new UsageError(`opi subkey ${sub} ID`);const r=sub==='revoke'?await opi.keys.revoke(id):sub==='pause'?await opi.keys.pause(id):await opi.keys.resume(id);io.out(sub==='revoke'&&'revoked'in r?`Revoked ${r.revoked} key(s).`:`${sub==='pause'?'Paused':'Resumed'} ${'affected'in r?r.affected:0} key(s).`);return 0;}
  throw new UsageError('opi subkey create | list | revoke ID | pause ID | resume ID');}

 if(command==='ai'){const task=args[1];if(!task||task.startsWith('--'))throw new UsageError('opi ai "TASK"');const opi=keyClient();const wait=int(args,'--wait');
  const run=wait?await opi.ai.runAndWait(task,{timeoutMs:wait*1000,...(io.signal?{signal:io.signal}:{})}):await opi.ai.run(task);
  if(run.status==='awaiting_confirmation'){const p=run.pending_action;io.err(`Waiting for your approval in the dashboard: ${p?.method??''} ${p?.api??''}${p?.path??''}. Re-run with --wait SECONDS to wait, or continue later.`);io.out(run.id);return 2;}
  if(run.status!=='completed'){io.err(`AI mode run ${run.status}${run.error?`: ${run.error}`:''} (${run.credits} credits).`);return 1;}
  io.out(run.answer??'');io.err(`${run.steps} steps, ${run.credits} credits.`);return 0;}

 if(command==='inbox'){const opi=keyClient();const sub=args[1];
  if(sub==='list'){for(const i of await opi.inbox.list())io.out(`${i.id}\t${i.name}\t${i.source}\t${i.status}\t${i.unread} unread\t${i.url}`);return 0;}
  if(sub==='create'){const name=flag(args,'--name');const source=flag(args,'--source') as InboxSource|undefined;if(!name||!source||!SOURCES.includes(source))throw new UsageError(`opi inbox create --name NAME --source ${SOURCES.join('|')} [--generate | --secret-name NAME]`);
   const secretName=flag(args,'--secret-name');const retention=int(args,'--retention',1);const created=await opi.inbox.create({name,source,...(has(args,'--generate')?{secret:'generate' as const}:secretName?{secret:{secret_name:secretName}}:{}),...(retention!==undefined?{retention_days:retention}:{})});
   io.out(created.url);io.err(`Inbox ${created.id} created. ${created.setup}`);return 0;}
  if(sub==='listen'){const id=args[2];if(!id||id.startsWith('--'))throw new UsageError('opi inbox listen ID [--forward URL] [--type T]');const forwardRaw=flag(args,'--forward');const forward=forwardRaw?forwardTarget(forwardRaw):null;const type=flag(args,'--type');
   io.err(`Listening on inbox ${id}${forward?`, forwarding to ${forward.href}`:''}. Press Ctrl+C to stop.`);
   await opi.inbox.listen(id,async event=>{
    if(!forward){io.out(JSON.stringify(event));return;}
    const headers:Record<string,string>={'content-type':event.content_type||'application/json','x-opi-inbox-id':id,'x-opi-event-id':event.id};if(event.type)headers['x-opi-event-type']=event.type;
    const response=await send(forward.href,{method:'POST',headers,body:typeof event.body==='string'?event.body:JSON.stringify(event.body),redirect:'manual'});
    void response.body?.cancel().catch(()=>undefined);
    if(!response.ok)throw new Error(`Your app returned ${response.status}; the message will be redelivered.`);
    io.err(`${event.id}\t${event.type??''}\t→ ${response.status}`);
   },{...(io.signal?{signal:io.signal}:{}),...(type?{type}:{}),onError:e=>io.err(e instanceof Error?e.message:'Inbox error; retrying.')});
   return 0;}
  throw new UsageError('opi inbox list | create | listen ID');}

 io.out(HELP);return 0;
 }catch(error){
  if(error instanceof UsageError){io.err(error.message);return 64;}
  if(error instanceof SignInRequired){io.err('Not signed in. Run opi login first.');return 1;}
  if(error instanceof OpiError){io.err(`${error.message} (${error.code})`);return 1;}
  throw error;
 }
}
