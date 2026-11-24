export type SecretMetadata={id:string;name:string;service:string;description:string|null;environment:string;expired:boolean;gateway_ready:boolean};
export class OpiError extends Error{constructor(readonly code:string,readonly status:number,message='OPI request failed.'){super(message);this.name=new.target.name;}}
export class OpiAuthError extends OpiError{}
export class OpiForbiddenError extends OpiError{}
export class OpiRateLimitError extends OpiError{}
export class OpiEncryptionUnavailableError extends OpiError{}
export class OpiApprovalRequiredError extends OpiError{constructor(code:string,status:number,readonly approvalId:string){super(code,status,'Owner approval is required.');}}
export class OpiTimeoutError extends OpiError{}
const env=()=> (globalThis as typeof globalThis&{process?:{env?:Record<string,string|undefined>}}).process?.env;
export function secureBaseUrl(value:string){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&url.hostname==='localhost')))throw new OpiError('invalid_base_url',0,'Use HTTPS, or http://localhost for development.');return url.origin;}
const safeMessages:Record<string,string>={invalid_key:'OPI Key is invalid or revoked.',missing_key:'An OPI Key is required.',forbidden:'Access denied.',mode_disabled:'This connection mode is disabled.',encryption_unavailable:'Encryption is temporarily unavailable.',external_cost_unavailable:'A verified price rule is required for this capped call.'};
export async function checkResponse(response:Response):Promise<Response>{if(response.ok)return response;let data:unknown;try{data=await response.clone().json();}catch{/* Do not echo arbitrary response content. */}const error=data&&typeof data==='object'&&'error'in data&&data.error&&typeof data.error==='object'?data.error:null;const code=error&&'code'in error&&typeof error.code==='string'?error.code:'request_failed';
 if(code==='approval_required'){const id=error&&'approval_id'in error&&typeof error.approval_id==='string'?error.approval_id:'';throw new OpiApprovalRequiredError(code,response.status,id);}
 const Klass=code==='encryption_unavailable'?OpiEncryptionUnavailableError:response.status===401?OpiAuthError:response.status===429?OpiRateLimitError:response.status===403?OpiForbiddenError:OpiError;
 throw new Klass(code,response.status,safeMessages[code]??'OPI request failed.');}
const ENV_NAME=/^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED=new Set(['__proto__','prototype','constructor']);
/** Environment-variable name for a secret. Valid names are kept; others are uppercased with every other character turned into "_" (httpbin-test -> HTTPBIN_TEST). */
export function toEnvName(name:string):string{if(ENV_NAME.test(name))return name;let converted=name.toUpperCase().replace(/[^A-Z0-9_]/g,'_');if(/^[0-9]/.test(converted))converted='_'+converted;return converted;}
/** Pairs each secret with its environment-variable name. Throws env_name_conflict instead of silently overwriting when two secrets map to one name. */
export function envEntries(secrets:Record<string,unknown>):{secret:string;env:string;value:string}[]{const seen=new Map<string,string>();const entries:{secret:string;env:string;value:string}[]=[];for(const [secret,value]of Object.entries(secrets)){if(typeof value!=='string')continue;const env=toEnvName(secret);if(RESERVED.has(env)||!ENV_NAME.test(env))continue;const previous=seen.get(env);if(previous!==undefined)throw new OpiError('env_name_conflict',0,`Secrets "${previous}" and "${secret}" both map to ${env}. Rename one of them.`);seen.set(env,secret);entries.push({secret,env,value});}return entries;}
export class Opi{
 #key:string;readonly baseUrl:string;
 constructor(options:{key?:string;baseUrl?:string}={}){this.#key=options.key??env()?.['OPIKEY']??'';if(!this.#key)throw new OpiAuthError('missing_key',401,'An OPI Key is required.');this.baseUrl=secureBaseUrl(options.baseUrl??'https://opikey.ai');}
 toString(){return 'Opi { key: [hidden] }';}
 toJSON(){return {baseUrl:this.baseUrl,key:'[hidden]'};}
 [Symbol.for('nodejs.util.inspect.custom')](){return this.toString();}
 async #request(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('authorization',`Bearer ${this.#key}`);return checkResponse(await globalThis.fetch(this.baseUrl+path,{...init,headers,redirect:'manual'}));}
 fetch(secret:string,path:string,init:RequestInit={}){if(!/^[A-Za-z0-9_.-]{1,64}$/.test(secret)||!path.startsWith('/')||path.startsWith('//'))throw new OpiError('invalid_secret',0,'Provide a secret name and an absolute API path.');return this.#request('/api/public/gateway/'+encodeURIComponent(secret)+path,init);}
 async listSecrets():Promise<SecretMetadata[]>{const response=await this.#request('/api/public/secrets');return (await response.json() as {secrets:SecretMetadata[]}).secrets;}
 async loadSecrets(options:{target?:Record<string,string|undefined>;override?:boolean;only?:string[]}={}):Promise<string[]>{const target=options.target??env();if(!target)throw new OpiError('target_required',0,'Provide a target object in this runtime.');const response=await this.#request('/api/public/secrets-fetch');const payload=await response.json() as {secrets:Record<string,unknown>};const loaded:string[]=[];for(const {secret,env:name,value}of envEntries(payload.secrets)){if((options.only&&!options.only.includes(secret)&&!options.only.includes(name))||(!options.override&&Object.hasOwn(target,name)))continue;target[name]=value;loaded.push(name);}return loaded;}
 async waitForApproval(id:string,options:{timeoutMs:number}){if(!/^[a-f0-9-]{36}$/i.test(id))throw new OpiError('invalid_approval',0,'Invalid approval identifier.');const deadline=Date.now()+options.timeoutMs;while(Date.now()<deadline){const remaining=deadline-Date.now();const response=await this.#request('/api/public/approvals/'+encodeURIComponent(id),{signal:AbortSignal.timeout(Math.max(1,remaining))});const result=await response.json() as {status:string};if(result.status!=='pending')return result.status;await new Promise(r=>setTimeout(r,Math.min(1000,Math.max(1,deadline-Date.now()))));}throw new OpiTimeoutError('approval_timeout',0,'Approval wait timed out.');}
}
