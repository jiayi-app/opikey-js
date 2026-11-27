import {OpiKey,OpiError,OpiAuthError,secureBaseUrl,checkResponse,type AiResult,type AiModel,type HttpMethod,type Usage} from '@opikey/sdk';
export type CliIO={out:(text:string)=>void;err:(text:string)=>void;
 /** The OPI Key saved by `opi login` (OS keychain, or a private 0600 file). */
 read:()=>Promise<string|null>;save:(key:string)=>Promise<void>;clear:()=>Promise<void>;
 open:(url:string)=>void;run:(command:string,args:string[],env:Record<string,string|undefined>)=>Promise<number>;signal?:AbortSignal;
 /** Asks a question on the terminal and returns the typed answer, or null when there is no interactive terminal. */
 prompt?:(question:string)=>Promise<string|null>;
 /** Used to name the OPI Key that `opi login` creates. */
 hostname?:string};

const HELP=`OPIKey CLI: AI-native API Gateway. Commands work as \`opi\` or \`opikey\`.

  opi login                        create an OPI Key for this computer (you approve it in your browser)
  opi logout                       revoke that key and remove it from this computer
  opi whoami                       which OPI Key is in use, and what it can do

  opi "PLAIN-LANGUAGE REQUEST"     AI mode: OPIKey's AI makes the API calls and prints the result
  opi ai "REQUEST" [--model fast|smart] [--confirm ID]
  opi call API METHOD PATH [--data JSON]
                                   exact call through the gateway, e.g. opi call openai GET /v1/models
  opi apis                         the APIs this key can use (names only, never values)
  opi usage                        this month's credits: left, used and where they went
  opi run -- COMMAND               run a program with the key's granted secrets in its environment (fetch mode)

The OPI Key comes from OPIKEY_KEY (or OPIKEY) if set, otherwise from opi login. It's never read from an argument, so it stays out of your shell history.`;

/** Value after a flag, or undefined. A flag never consumes another flag or anything after "--". */
function flag(args:string[],name:string){const end=args.indexOf('--');const i=args.indexOf(name);if(i<0||(end>=0&&i>end))return undefined;const v=args[i+1];return v===undefined||v.startsWith('--')?undefined:v;}
class UsageError extends Error{}
/** Kept in step with package.json by a test. */
export const VERSION='0.5.0';
const COMMANDS=new Set(['login','logout','whoami','apis','vault','run','ai','call','usage','credits','help','--help','-h','version','--version','-v']);
/** Commands that existed before 0.5 and were removed with the features they used. */
const REMOVED:Record<string,string>={
 keys:'Manage OPI Keys on the OPI Keys page at opikey.ai.',secrets:'Use opi apis to see what this key can use.',setup:'Connect with the CLI, the SDK or HTTPS instead. See opikey.ai/docs.',
 subkey:'Sub-keys were removed. Create separate OPI Keys on the OPI Keys page.',inbox:'Agent Inbox was removed.',
};
const METHODS=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const KEY_FORMAT=/^opk_[A-Za-z0-9_]{8,200}$/;
const n=(value:number)=>value.toLocaleString('en-US');

/** One line about what a request used, for stderr. */
export function usageLine(u:Usage|null|undefined){if(!u)return '';const parts=[`${n(u.api_calls)} API call${u.api_calls===1?'':'s'}`];if(u.input_tokens||u.output_tokens)parts.push(`${n(u.input_tokens)} in / ${n(u.output_tokens)} out tokens${u.model?` (${u.model})`:''}`);parts.push(`${n(u.total_credits)} credits`);return parts.join(' · ');}

/**
 * The text of a plain-language request: everything before the first flag.
 * A single unknown word is treated as a typo, not as an AI request, so a mistyped command never spends credits.
 */
export function plainRequest(args:string[]){const end=args.findIndex(a=>a.startsWith('--'));const words=(end<0?args:args.slice(0,end));const text=words.join(' ').trim();return words.length>1||/\s/.test(words[0]??'')?text:null;}

/** Name for the OPI Key that `opi login` creates, e.g. "CLI on MacBook". */
export function deviceName(hostname:string|undefined){const host=(hostname??'').replace(/\.local$/i,'').replace(/[^\p{L}\p{N} ._-]/gu,'').trim().slice(0,40)||'this computer';return `CLI on ${host}`.slice(0,80);}

export async function cli(args:string[],io:CliIO,environment:Record<string,string|undefined>,send:typeof fetch=fetch):Promise<number>{
 const base=secureBaseUrl(environment['OPIKEY_BASE_URL']??'https://opikey.ai');const command=args[0];
 const envKey=()=>environment['OPIKEY_KEY']||environment['OPIKEY']||'';
 /** The saved key from `opi login`. A value saved by an older CLI (a session token) is ignored. */
 async function savedKey(){const value=(await io.read())?.trim()??'';if(!value)return '';if(!KEY_FORMAT.test(value)){io.err('Your saved sign-in is from an older version of the CLI. Run opi login to create an OPI Key for this computer.');return '';}return value;}
 /** The key in use: OPIKEY_KEY / OPIKEY, otherwise the one saved by opi login. Never read from an argument (it would end up in shell history). */
 async function resolveKey(){const fromEnv=envKey();if(fromEnv)return {key:fromEnv,source:'the OPIKEY_KEY environment variable'};const saved=await savedKey();if(saved)return {key:saved,source:'opi login'};return null;}
 async function keyClient(){const found=await resolveKey();if(!found)throw new UsageError('No OPI Key. Run opi login, or set the OPIKEY_KEY environment variable.');return new OpiKey({key:found.key,baseUrl:base});}

 /** AI mode, with a typed confirmation before any previewed write runs. */
 async function ai(input:string,rest:string[]):Promise<number>{
  if(!input||input.length>4000)throw new UsageError('Give a plain-language request of 1–4,000 characters, in quotes.');
  const model=flag(rest,'--model');if(model!==undefined&&model!=='fast'&&model!=='smart')throw new UsageError('--model must be fast or smart.');
  const opi=await keyClient();const options={...(model?{model:model as AiModel}:{}),...(io.signal?{signal:io.signal}:{})};
  const confirm=flag(rest,'--confirm');
  let result:AiResult=await opi.ai(input,{...options,...(confirm?{confirmId:confirm}:{})});
  if(result.status==='needs_confirmation'){
   io.err(`This needs your confirmation${result.reason?`: ${result.reason}`:'.'}`);
   for(const c of result.planned_calls??[])io.err(`  ${c.method} ${c.api}${c.path}`);
   const line=usageLine(result.usage);if(line)io.err(line);
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

 /** Device sign-in that ends with a new OPI Key for this computer, saved to the keychain. The key is never printed. */
 async function login():Promise<number>{
  const name=(environment['OPIKEY_DEVICE_NAME']?.trim()||deviceName(io.hostname)).slice(0,80);
  const response=await checkResponse(await send(base+'/api/public/cli/device/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device_name:name,grant:'opi_key'}),redirect:'manual'}));
  const data=await response.json() as {device_code:string;user_code:string;verification_uri:string;interval:number;expires_in:number};
  const verify=new URL(data.verification_uri);if(verify.origin!==base||verify.pathname!=='/cli/activate')throw new Error('Invalid verification page.');
  io.out(`Open ${verify.href}\nCheck that the page shows ${data.user_code}, then approve the new OPI Key "${name}".`);io.open(verify.href);
  const deadline=Date.now()+data.expires_in*1000;let interval=Math.max(0,data.interval)*1000;
  while(Date.now()<deadline){
   await new Promise(r=>setTimeout(r,interval));
   const result=await send(base+'/api/public/cli/device/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device_code:data.device_code}),redirect:'manual'});
   const body=await result.json().catch(()=>({})) as {opi_key?:string;key_name?:string;access_token?:string;error?:{code?:string}};
   if(result.ok&&body.opi_key){
    if(!KEY_FORMAT.test(body.opi_key)){io.err('OPIKey returned an unexpected key format. Nothing was saved.');return 1;}
    await io.save(body.opi_key);
    io.out(`Signed in. Created the OPI Key "${body.key_name??name}" for this computer. Change its access or revoke it on the OPI Keys page.`);
    if(envKey())io.err('Note: OPIKEY_KEY is set in this shell, and it takes precedence over the key from opi login.');
    return 0;}
   if(result.ok&&body.access_token){io.err('OPIKey returned an old-style session instead of an OPI Key. Update to the latest CLI, or try again later.');return 1;}
   const code=body.error?.code;if(code==='slow_down'){interval+=5000;continue;}if(code==='authorization_pending')continue;
   io.err(code==='access_denied'?'Denied in the browser. No key was created.':'The sign-in request expired. Run opi login again.');return 1;}
  io.err('The sign-in request expired. Run opi login again.');return 1;
 }

 /** Revoke the key saved by opi login and forget it. Keys from OPIKEY_KEY are never revoked here. */
 async function logout():Promise<number>{
  const saved=await savedKey();
  if(!saved){await io.clear();io.out('Not signed in on this computer.');if(envKey())io.err('OPIKEY_KEY is still set in this shell. Unset it yourself if you want; revoke that key on the OPI Keys page.');return 0;}
  let revoked=false;try{await new OpiKey({key:saved,baseUrl:base}).revokeThisKey();revoked=true;}catch(error){if(error instanceof OpiAuthError)revoked=true;else{io.err(`Couldn't revoke the key${error instanceof OpiError?` (${error.code})`:''}. It was removed from this computer; revoke it on the OPI Keys page to be sure.`);}}
  await io.clear();io.out(revoked?'Signed out. The OPI Key for this computer was revoked.':'Signed out on this computer.');return revoked?0:1;
 }

 if(command==='--version'||command==='-v'||command==='version'){io.out(VERSION);return 0;}
 if(command===undefined||command==='help'||command==='--help'||command==='-h'){io.out(HELP);return 0;}
 try{
 if(command==='login')return await login();
 if(command==='logout')return await logout();

 if(command==='whoami'){const found=await resolveKey();if(!found)throw new UsageError('No OPI Key. Run opi login, or set the OPIKEY_KEY environment variable.');const k=await new OpiKey({key:found.key,baseUrl:base}).whoami();
  io.out(`${k.name}\t${k.prefix}…`);io.out(`from\t${found.source}`);io.out(`APIs\t${k.access==='all'?'all APIs in your Vault':k.apis.join(', ')||'none yet'}`);io.out(`firewall\t${k.firewall_level}`);io.out(`AI writes\t${k.ai_writes}`);io.out(`expires\t${k.expires_at??'never'}`);return 0;}

 if(command==='apis'||command==='vault'){const list=await (await keyClient()).listSecrets();if(!list.length)io.err('This key can\'t use any APIs yet. Add APIs to your Vault, or choose them on the key\'s page.');for(const s of list)io.out(`${s.name}\t${s.service}\t${s.environment}${s.gateway_ready?'':'\t(no base URL: fetch mode only)'}`);return 0;}

 if(command==='run'){const separator=args.indexOf('--');const executable=separator>=0?args[separator+1]:undefined;if(!executable)throw new UsageError('opi run -- COMMAND');if(flag(args,'--key'))throw new UsageError('opi run no longer takes --key. It uses the key from opi login or OPIKEY_KEY.');
  const childEnv={...environment};delete childEnv['OPIKEY'];delete childEnv['OPIKEY_KEY'];delete childEnv['OPIKEY_BASE_URL'];
  await (await keyClient()).loadSecrets({target:childEnv});
  return io.run(executable,args.slice(separator+2),childEnv);}

 if(command==='ai'){const end=args.findIndex((a,i)=>i>0&&a.startsWith('--'));const input=args.slice(1,end<0?undefined:end).join(' ').trim();if(!input)throw new UsageError('opi ai "PLAIN-LANGUAGE REQUEST"');return await ai(input,args.slice(1));}

 if(command==='call'){const [api,methodRaw,path]=[args[1],args[2],args[3]];const method=methodRaw?.toUpperCase();
  if(!api||!method||!path||!METHODS.has(method)||!path.startsWith('/'))throw new UsageError('opi call API METHOD PATH [--data JSON], e.g. opi call openai GET /v1/models');
  const raw=flag(args,'--data');let data:unknown;if(raw!==undefined){try{data=JSON.parse(raw);}catch{throw new UsageError('--data must be valid JSON.');}}
  const r=await (await keyClient()).call({api,method:method as HttpMethod,path,...(data!==undefined?{body:data}:{}),...(io.signal?{signal:io.signal}:{})});
  const text=await r.response.text();if(text)io.out(text);
  const parts=[String(r.status)];if(r.check?.verdict)parts.push(r.check.verdict);if(r.creditsCharged!==null)parts.push(`${n(r.creditsCharged)} credits`);io.err(parts.join(' · '));
  return r.ok?0:1;}

 if(command==='usage'||command==='credits'){const u=await (await keyClient()).usage();
  io.out(`${n(u.credits_left)} of ${n(u.credits_included)} credits left${u.extra_credits_left?` (+${n(u.extra_credits_left)} extra)`:''}`);
  io.out(`used\t${n(u.credits_used)}\t(API calls ${n(u.breakdown.api_calls)} · AI mode ${n(u.breakdown.ai_mode)} · AI Firewall ${n(u.breakdown.ai_firewall)})`);
  io.out(`resets\t${u.resets_at??'—'}`);return 0;}

 const removed=REMOVED[command];if(removed){io.err(`opi ${command} was removed in 0.5. ${removed}`);return 64;}
 const request=COMMANDS.has(command)?null:plainRequest(args);
 if(request)return await ai(request,args);
 io.err(`Unknown command "${command}". To ask in plain language, put the request in quotes: opi "what can you do?"`);io.out(HELP);return 64;
 }catch(error){
  if(error instanceof UsageError){io.err(error.message);return 64;}
  if(error instanceof OpiError){io.err(`${error.message} (${error.code})`);return 1;}
  throw error;
 }
}
