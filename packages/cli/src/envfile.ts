/** Reading .env files for `opi import`. Pure functions: no file or network access here. */
export type EnvEntry={name:string;value:string;start:number;end:number};

const NAME=/^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Parse KEY=VALUE lines, with `export`, comments, single/double quotes and multi-line double-quoted values. Line numbers are 0-based and inclusive. */
export function parseEnv(text:string):EnvEntry[]{
 const lines=text.split(/\r?\n/);const out:EnvEntry[]=[];
 for(let i=0;i<lines.length;i++){
  let line=(lines[i]??'').trim();if(!line||line.startsWith('#'))continue;
  if(line.startsWith('export '))line=line.slice(7).trim();
  const eq=line.indexOf('=');if(eq<1)continue;
  const name=line.slice(0,eq).trim();if(!NAME.test(name))continue;
  let rest=line.slice(eq+1).trim();const start=i;let value:string;
  const q=rest[0];
  if(q==='"'||q==="'"){
   let body=rest.slice(1);let close=findClose(body,q);
   while(close<0&&q==='"'&&i+1<lines.length){i++;body+='\n'+(lines[i]??'');close=findClose(body,q);}
   if(close<0)continue;
   value=body.slice(0,close);if(q==='"')value=value.replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
  }else{const hash=rest.search(/\s#/);if(hash>=0)rest=rest.slice(0,hash);value=rest.trim();}
  const existing=out.findIndex(e=>e.name===name);if(existing>=0)out.splice(existing,1);
  out.push({name,value,start,end:i});
 }
 return out;
}
function findClose(body:string,q:string){for(let j=0;j<body.length;j++){if(body[j]==='\\'&&q==='"'){j++;continue;}if(body[j]===q)return j;}return -1;}

/** Variables that are never secrets, or are public by design. */
const NOT_SECRET=new Set(['NODE_ENV','PORT','HOST','HOSTNAME','DEBUG','LOG_LEVEL','TZ','CI','ENV','ENVIRONMENT','OPIKEY_KEY','OPIKEY','OPIKEY_BASE_URL']);
const PUBLIC_PREFIX=/^(NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|GATSBY_)/;
const SECRET_NAME=/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|DSN|AUTH|CREDENTIAL|PRIVATE|SIGNING)/i;

/** Known key formats and names → API directory service hint. Order matters: more specific first. */
const BY_VALUE:[RegExp,string][]=[
 [/^sk-ant-/,'anthropic'],[/^sk-or-/,'openrouter'],[/^sk-(proj-)?[A-Za-z0-9_-]{20,}/,'openai'],[/^(sk|rk)_(live|test)_/,'stripe'],[/^whsec_/,'stripe'],
 [/^re_[A-Za-z0-9]{8,}/,'resend'],[/^xox[abpr]-/,'slack'],[/^(ghp|gho|ghu|ghs)_|^github_pat_/,'github'],[/^SG\./,'sendgrid'],[/^AIza[0-9A-Za-z_-]{20,}/,'google'],
 [/^gsk_/,'groq'],[/^pplx-/,'perplexity'],[/^tvly-/,'tavily'],[/^fc-[a-f0-9]{20,}/,'firecrawl'],[/^hf_/,'huggingface'],[/^r8_/,'replicate'],[/^key-[a-f0-9]{32}$/,'mailgun'],
];
const BY_NAME:[RegExp,string][]=[
 [/^ANTHROPIC/,'anthropic'],[/^OPENROUTER/,'openrouter'],[/^OPENAI/,'openai'],[/^STRIPE/,'stripe'],[/^RESEND/,'resend'],[/^SLACK/,'slack'],[/^(GITHUB|GH)_/,'github'],
 [/^SENDGRID/,'sendgrid'],[/^(GOOGLE|GEMINI)/,'google'],[/^GROQ/,'groq'],[/^PERPLEXITY/,'perplexity'],[/^TAVILY/,'tavily'],[/^FIRECRAWL/,'firecrawl'],[/^EXA_/,'exa'],
 [/^BRAVE/,'brave'],[/^TWILIO/,'twilio'],[/^POSTMARK/,'postmark'],[/^MAILGUN/,'mailgun'],[/^REPLICATE/,'replicate'],[/^(HUGGINGFACE|HF)_/,'huggingface'],[/^SUPABASE/,'supabase'],
];
export function detectService(name:string,value:string):string|undefined{for(const [re,s]of BY_VALUE)if(re.test(value))return s;const upper=name.toUpperCase();for(const [re,s]of BY_NAME)if(re.test(upper))return s;return undefined;}

export type Candidate={name:string;value:string;service?:string;reason?:string};
/** Split entries into likely secrets to import and the rest, with a reason for each skipped one. `all` keeps everything that isn't empty or OPIKey's own. */
export function pickSecrets(entries:EnvEntry[],all=false):{secrets:Candidate[];skipped:Candidate[]}{
 const secrets:Candidate[]=[];const skipped:Candidate[]=[];
 for(const e of entries){
  const name=e.name.toUpperCase();const service=detectService(e.name,e.value);const base={name:e.name,value:e.value,...(service?{service}:{})};
  if(!e.value){skipped.push({...base,reason:'empty'});continue;}
  if(name.startsWith('OPIKEY')){skipped.push({...base,reason:'OPIKey\'s own setting'});continue;}
  if(!/^[A-Za-z0-9_.-]{1,64}$/.test(e.name)){skipped.push({...base,reason:'name too long or unsupported'});continue;}
  if(all){secrets.push(base);continue;}
  if(NOT_SECRET.has(name)){skipped.push({...base,reason:'not a secret'});continue;}
  if(PUBLIC_PREFIX.test(name)){skipped.push({...base,reason:'public by design'});continue;}
  if(/^(true|false|yes|no|on|off|\d+(\.\d+)?)$/i.test(e.value)){skipped.push({...base,reason:'not a secret'});continue;}
  const urlWithCredentials=/^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(e.value);
  if(service||SECRET_NAME.test(name)||urlWithCredentials){secrets.push(base);continue;}
  skipped.push({...base,reason:'doesn\'t look like a secret (use --all to include it)'});
 }
 return {secrets,skipped};
}

/** First 4 characters, then a fixed mask. Short values are fully masked. */
export function mask(value:string){return value.length<12?'••••':`${value.slice(0,4)}••••`;}

/** Remove the given variables' lines from a .env file and leave one comment saying where they went. */
export function removeFromEnv(text:string,entries:EnvEntry[],names:Set<string>){
 const lines=text.split(/\r?\n/);const drop=new Set<number>();
 for(const e of entries)if(names.has(e.name))for(let i=e.start;i<=e.end;i++)drop.add(i);
 const kept=lines.filter((_,i)=>!drop.has(i));
 const note=`# Moved to your OPIKey Vault: ${[...names].join(', ')}. Run your app with: opi run -- <command>`;
 return [note,...kept].join('\n');
}
