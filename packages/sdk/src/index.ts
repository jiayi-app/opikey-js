// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type SecretMetadata={id:string;name:string;service:string;description:string|null;environment:string;expired:boolean;gateway_ready:boolean};

/** The AI Firewall's verdict on a request. */
export type Check={verdict:string;tier?:number;reason?:string;ai?:{used:boolean;why:string|null};[field:string]:unknown};
/** What a request used: API calls, AI tokens and credits. */
export type Usage={api_calls:number;model:string|null;input_tokens:number;output_tokens:number;model_cost_usd:number;ai_credits:number;call_credits:number;total_credits:number};
export type AiModel='fast'|'smart';
export type AiStatus='done'|'needs_confirmation'|'blocked';
export type AiCall={api:string;method:string;path:string;status:number};
export type PlannedCall={api:string;method:string;path:string;body?:unknown};
/** Response of AI mode (`POST /api/public/v1/ai`). */
export type AiResult={
 result:string;calls:AiCall[];status:AiStatus;usage:Usage;check:Check;
 /** Present when `status` is `needs_confirmation`. Send the same input again with it to run the planned calls. Works once; expires after 15 minutes. */
 confirm_id?:string;planned_calls?:PlannedCall[];reason?:string;
};
export type AiOptions={model?:AiModel;confirmId?:string;signal?:AbortSignal};

export type HttpMethod='GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE'|'OPTIONS';
export type CallInput={api:string;method?:HttpMethod;path:string;body?:unknown;query?:Record<string,string|number|boolean|undefined>;headers?:HeadersInit;signal?:AbortSignal};
/** An exact call through the gateway. `response` is the provider's response, unchanged. */
export type CallResult={response:Response;status:number;ok:boolean;check:Check|null;usage:Usage|null;creditsCharged:number|null};

export type AccountUsage={credits_left:number;credits_included:number;credits_used:number;extra_credits_left:number;resets_at:string|null;breakdown:{api_calls:number;ai_mode:number;ai_firewall:number}};
/** @deprecated Use `usage()`. */
export type Credits={balance:number;monthly_remaining:number;purchased_remaining:number;next_grant_at:string|null};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class OpiError extends Error{
 /** Safe, structured fields from the error response (numbers, booleans and short identifiers only). */
 readonly details:Readonly<Record<string,string|number|boolean|null>>;
 constructor(readonly code:string,readonly status:number,message='OPIKey request failed.',details:Record<string,string|number|boolean|null>={}){super(message);this.name=new.target.name;this.details=Object.freeze({...details});}
}
export class OpiAuthError extends OpiError{}
export class OpiForbiddenError extends OpiError{}
export class OpiRateLimitError extends OpiError{}
export class OpiEncryptionUnavailableError extends OpiError{}
export class OpiTimeoutError extends OpiError{}
/** The AI Firewall or the key's approval rules held the request for the owner. */
export class OpiApprovalRequiredError extends OpiError{constructor(code:string,status:number,readonly approvalId:string,details:Record<string,string|number|boolean|null>={}){super(code,status,'Owner approval is required.',details);}}
/** 402: the account is out of credits. `details.needed` / `details.available` when provided. */
export class OpiInsufficientCreditsError extends OpiError{}
/** 429: this OPI Key's own call or credit limit is used up. */
export class OpiBudgetExhaustedError extends OpiError{}
/** Blocked by the AI Firewall. `incidentId` points to the entry in the audit log, when provided. */
export class OpiSecurityBlockedError extends OpiError{constructor(code:string,status:number,readonly incidentId:string|null,details:Record<string,string|number|boolean|null>={}){super(code,status,'Blocked by the OPIKey AI Firewall.',details);}}
/** 409: the confirm_id is unknown, already used, expired or for a different input. */
export class OpiConfirmationError extends OpiError{}
/** 410: the feature has been paused. */
export class OpiFeaturePausedError extends OpiError{}
/** 503: the AI model is unavailable. Nothing was charged. */
export class OpiAiUnavailableError extends OpiError{}
/** Same class as `OpiError`, under the name used in the OPIKey docs. */
export const OpiKeyError=OpiError;export type OpiKeyError=OpiError;
/** Same class as `OpiInsufficientCreditsError`, under the name used in the OPIKey docs. */
export const InsufficientCreditsError=OpiInsufficientCreditsError;export type InsufficientCreditsError=OpiInsufficientCreditsError;

const env=()=> (globalThis as typeof globalThis&{process?:{env?:Record<string,string|undefined>}}).process?.env;
export function secureBaseUrl(value:string){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&url.hostname==='localhost')))throw new OpiError('invalid_base_url',0,'Use HTTPS, or http://localhost for development.');return url.origin;}
const safeMessages:Record<string,string>={
 invalid_key:'OPI Key is invalid or revoked.',missing_key:'An OPI Key is required.',forbidden:'Access denied.',mode_disabled:'This connection mode is disabled for this key.',
 encryption_unavailable:'Encryption is temporarily unavailable.',insufficient_credits:'Not enough OPIKey credits.',
 budget_exhausted:'This OPI Key has used its credit limit.',calls_exhausted:'This OPI Key has used its call limit.',call_limit_reached:'This OPI Key has reached its call limit.',
 key_paused:'This OPI Key is paused.',key_expired:'This OPI Key has expired.',rate_limited:'Too many requests. Try again shortly.',not_found:'Not found.',
 browser_origin_blocked:'OPI Keys can\'t be used from browser code. Call OPIKey from your server or agent, or allow this origin on the key.',
 confirmation_invalid:'This confirmation is unknown, already used, expired or for a different input.',feature_paused:'This feature is paused.',
 ai_mode_unavailable:'AI mode is temporarily unavailable. Nothing was charged.',invalid_request:'The request is not valid.',
};
/** Error codes that OPIKey itself returns. Any other error on an exact call is the provider's own response. */
const OPIKEY_CODES=new Set([...Object.keys(safeMessages),'approval_required','check_held','security_blocked','response_blocked_injection']);
const SAFE_DETAIL=/^[A-Za-z0-9_.:@\/-]{1,120}$/;
function safeDetails(error:object):Record<string,string|number|boolean|null>{const out:Record<string,string|number|boolean|null>={};for(const [k,v]of Object.entries(error)){if(k==='message'||k==='code'||!/^[a-z_]{1,40}$/.test(k))continue;if(typeof v==='number'&&Number.isFinite(v))out[k]=v;else if(typeof v==='boolean'||v===null)out[k]=v;else if(typeof v==='string'&&SAFE_DETAIL.test(v))out[k]=v;}return out;}
async function errorCode(response:Response){let data:unknown;try{data=await response.clone().json();}catch{/* Do not echo arbitrary response content. */}
 const error=data&&typeof data==='object'&&'error'in data&&data.error&&typeof data.error==='object'?data.error:null;
 const code=error&&'code'in error&&typeof error.code==='string'&&/^[a-z_]{1,60}$/.test(error.code)?error.code:'request_failed';
 return {code,details:error?safeDetails(error):{}};}
function typedError(code:string,status:number,details:Record<string,string|number|boolean|null>):OpiError{
 if(code==='approval_required'||code==='check_held')return new OpiApprovalRequiredError(code,status,typeof details['approval_id']==='string'?details['approval_id']:'',details);
 if(code==='security_blocked'||code==='response_blocked_injection')return new OpiSecurityBlockedError(code,status,typeof details['incident_id']==='string'?details['incident_id']:null,details);
 const Klass=code==='encryption_unavailable'?OpiEncryptionUnavailableError:status===402||code==='insufficient_credits'?OpiInsufficientCreditsError:code==='budget_exhausted'||code==='calls_exhausted'||code==='call_limit_reached'?OpiBudgetExhaustedError
  :code==='confirmation_invalid'?OpiConfirmationError:code==='feature_paused'?OpiFeaturePausedError:code==='ai_mode_unavailable'?OpiAiUnavailableError
  :status===401?OpiAuthError:status===429?OpiRateLimitError:status===403?OpiForbiddenError:OpiError;
 return new Klass(code,status,safeMessages[code]??'OPIKey request failed.',details);}
export async function checkResponse(response:Response):Promise<Response>{if(response.ok)return response;const {code,details}=await errorCode(response);throw typedError(code,response.status,details);}

/** Parse a JSON header object, ignoring anything malformed. */
function headerJson<T>(response:Response,name:string):T|null{const raw=response.headers.get(name);if(!raw||raw.length>8192)return null;try{const value:unknown=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value as T:null;}catch{return null;}}
function headerNumber(response:Response,name:string){const raw=response.headers.get(name);if(raw===null||!/^\d+(\.\d+)?$/.test(raw.trim()))return null;return Number(raw);}

// ---------------------------------------------------------------------------
// Environment-name helpers
// ---------------------------------------------------------------------------
const ENV_NAME=/^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED=new Set(['__proto__','prototype','constructor']);
/** Environment-variable name for a secret. Valid names are kept; others are uppercased with every other character turned into "_" (httpbin-test -> HTTPBIN_TEST). */
export function toEnvName(name:string):string{if(ENV_NAME.test(name))return name;let converted=name.toUpperCase().replace(/[^A-Z0-9_]/g,'_');if(/^[0-9]/.test(converted))converted='_'+converted;return converted;}
/** Pairs each secret with its environment-variable name. Throws env_name_conflict instead of silently overwriting when two secrets map to one name. */
export function envEntries(secrets:Record<string,unknown>):{secret:string;env:string;value:string}[]{const seen=new Map<string,string>();const entries:{secret:string;env:string;value:string}[]=[];for(const [secret,value]of Object.entries(secrets)){if(typeof value!=='string')continue;const env=toEnvName(secret);if(RESERVED.has(env)||!ENV_NAME.test(env))continue;const previous=seen.get(env);if(previous!==undefined)throw new OpiError('env_name_conflict',0,`Secrets "${previous}" and "${secret}" both map to ${env}. Rename one of them.`);seen.set(env,secret);entries.push({secret,env,value});}return entries;}

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const API_NAME=/^[A-Za-z0-9_.-]{1,64}$/;
const METHODS=new Set<HttpMethod>(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
function apiPath(api:string,path:string){if(!API_NAME.test(api)||!path.startsWith('/')||path.startsWith('//'))throw new OpiError('invalid_request',0,'Provide an API name from your Vault and an absolute API path.');return '/api/public/gateway/'+encodeURIComponent(api)+path;}
function isBrowser(){const g=globalThis as {window?:unknown;document?:unknown};return typeof g.window!=='undefined'&&typeof g.document!=='undefined';}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export type OpiKeyOptions={
 /** Your OPI Key. Defaults to the OPIKEY_KEY environment variable (or OPIKEY). */
 key?:string;
 baseUrl?:string;
 /** OPI Keys belong on servers and in agents, never in browser code. Set this only if the key allows your site's origin. */
 allowBrowser?:boolean;
};

/** OPIKey client. Every request authenticates with your OPI Key. */
export class OpiKey{
 #key:string;readonly baseUrl:string;
 constructor(options:OpiKeyOptions={}){
  if(isBrowser()&&!options.allowBrowser)throw new OpiError('browser_origin_blocked',0,safeMessages['browser_origin_blocked']);
  this.#key=options.key??(env()?.['OPIKEY_KEY']||env()?.['OPIKEY']||'');if(!this.#key)throw new OpiAuthError('missing_key',401,'An OPI Key is required. Pass { key } or set OPIKEY_KEY.');
  this.baseUrl=secureBaseUrl(options.baseUrl??'https://opikey.ai');
 }
 toString(){return 'OpiKey { key: [hidden] }';}
 toJSON(){return {baseUrl:this.baseUrl,key:'[hidden]'};}
 [Symbol.for('nodejs.util.inspect.custom')](){return this.toString();}
 #send(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('authorization',`Bearer ${this.#key}`);return globalThis.fetch(this.baseUrl+path,{...init,headers,redirect:'manual'});}
 async #request(path:string,init:RequestInit={}){return checkResponse(await this.#send(path,init));}
 async #json<T>(path:string,init:RequestInit={}):Promise<T>{return (await this.#request(path,init)).json() as Promise<T>;}

 /**
  * AI mode: ask in plain language. OPIKey's AI picks the APIs this key may use, makes the calls and returns the result.
  * Risky writes come back with `status: 'needs_confirmation'`, the planned calls and a `confirm_id`; send the same input again with `{ confirmId }` to run them.
  */
 async ai(input:string,options:AiOptions={}):Promise<AiResult>{
  if(typeof input!=='string'||!input.trim()||input.length>4000)throw new OpiError('invalid_request',0,'Provide an input of 1–4,000 characters.');
  if(options.model!==undefined&&options.model!=='fast'&&options.model!=='smart')throw new OpiError('invalid_request',0,'model must be "fast" or "smart".');
  if(options.confirmId!==undefined&&!UUID.test(options.confirmId))throw new OpiError('invalid_request',0,'Invalid confirm_id.');
  return this.#json<AiResult>('/api/public/v1/ai',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input,...(options.model?{model:options.model}:{}),...(options.confirmId?{confirm_id:options.confirmId}:{})}),...(options.signal?{signal:options.signal}:{})});
 }

 /**
  * Exact call through the gateway. The real API key is added by OPIKey and never reaches your code.
  * Errors from OPIKey (credits, limits, the AI Firewall) throw; the provider's own error responses are returned as they are.
  */
 async call(input:CallInput):Promise<CallResult>{
  const method=(input.method??'GET').toUpperCase() as HttpMethod;if(!METHODS.has(method))throw new OpiError('invalid_request',0,'Unsupported HTTP method.');
  let path=apiPath(input.api,input.path);
  if(input.query){const q=new URLSearchParams();for(const [k,v]of Object.entries(input.query))if(v!==undefined)q.set(k,String(v));const s=q.toString();if(s)path+=(path.includes('?')?'&':'?')+s;}
  const headers=new Headers(input.headers);let body:BodyInit|undefined;
  if(input.body!==undefined&&method!=='GET'&&method!=='HEAD'){
   if(typeof input.body==='string'||input.body instanceof ArrayBuffer||input.body instanceof Uint8Array||(typeof Blob!=='undefined'&&input.body instanceof Blob)||(typeof FormData!=='undefined'&&input.body instanceof FormData)||(typeof URLSearchParams!=='undefined'&&input.body instanceof URLSearchParams))body=input.body as BodyInit;
   else{body=JSON.stringify(input.body);if(!headers.has('content-type'))headers.set('content-type','application/json');}}
  const response=await this.#send(path,{method,headers,...(body!==undefined?{body}:{}),...(input.signal?{signal:input.signal}:{})});
  if(!response.ok){const {code,details}=await errorCode(response);if(OPIKEY_CODES.has(code)||response.status===401||response.status===402)throw typedError(code,response.status,details);}
  return {response,status:response.status,ok:response.ok,check:headerJson<Check>(response,'x-opi-check'),usage:headerJson<Usage>(response,'x-opi-usage'),creditsCharged:headerNumber(response,'x-opi-credits-charged')};
 }

 /** This month's credits: left, included, used, extra, reset date and a breakdown into API calls, AI mode and AI Firewall. */
 usage():Promise<AccountUsage>{return this.#json<AccountUsage>('/api/public/usage');}

 /** Gateway call returning the raw Response. Prefer `call()`, which also returns the check and usage. Any non-2xx response throws. */
 fetch(api:string,path:string,init:RequestInit={}){return this.#request(apiPath(api,path),init);}
 /** Names and metadata of the APIs and secrets this key can use. Never values. */
 async listSecrets():Promise<SecretMetadata[]>{return (await this.#json<{secrets:SecretMetadata[]}>('/api/public/secrets')).secrets;}
 /** Fetch mode: load granted secret values into an environment object (process.env by default). Never overrides existing values unless `override` is set. */
 async loadSecrets(options:{target?:Record<string,string|undefined>;override?:boolean;only?:string[]}={}):Promise<string[]>{const target=options.target??env();if(!target)throw new OpiError('target_required',0,'Provide a target object in this runtime.');const payload=await this.#json<{secrets:Record<string,unknown>}>('/api/public/secrets-fetch');const loaded:string[]=[];for(const {secret,env:name,value}of envEntries(payload.secrets)){if((options.only&&!options.only.includes(secret)&&!options.only.includes(name))||(!options.override&&Object.hasOwn(target,name)))continue;target[name]=value;loaded.push(name);}return loaded;}
 /** @deprecated Use `usage()`. */
 credits():Promise<Credits>{return this.#json<Credits>('/api/public/credits');}
 /** Wait until the owner approves or denies a held request. Returns the final status. */
 async waitForApproval(id:string,options:{timeoutMs:number}){if(!UUID.test(id))throw new OpiError('invalid_approval',0,'Invalid approval identifier.');const deadline=Date.now()+options.timeoutMs;while(Date.now()<deadline){const remaining=deadline-Date.now();const result=await this.#json<{status:string}>('/api/public/approvals/'+encodeURIComponent(id),{signal:AbortSignal.timeout(Math.max(1,remaining))});if(result.status!=='pending')return result.status;await new Promise(r=>setTimeout(r,Math.min(1000,Math.max(1,deadline-Date.now()))));}throw new OpiTimeoutError('approval_timeout',0,'Approval wait timed out.');}
}

/** Earlier name of `OpiKey`. */
export const Opi=OpiKey;export type Opi=OpiKey;
