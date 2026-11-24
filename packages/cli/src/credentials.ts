import {mkdir,readFile,chmod,unlink,lstat,open,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
const directory=join(homedir(),'.config','opikey');const file=join(directory,'credentials');
async function entry(){const {Entry}=await import('@napi-rs/keyring');return new Entry('opikey','cli');}
async function privateDirectory(){await mkdir(directory,{recursive:true,mode:0o700});const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Unsafe credential directory.');await chmod(directory,0o700);}
export async function readCredential():Promise<string|null>{try{const result=(await entry()).getPassword();if(result)return result;}catch{/* Read only the private fallback. */}try{const dir=await lstat(directory);if(dir.isSymbolicLink()||!dir.isDirectory()||(dir.mode&0o077)!==0)return null;const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const stat=await handle.stat();if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>256)return null;return await handle.readFile('utf8');}finally{await handle.close();}}catch{return null;}}
export async function saveCredential(token:string,warn:(message:string)=>void){try{(await entry()).setPassword(token);await unlink(file).catch(()=>undefined);return;}catch{warn('OS keychain unavailable; storing your CLI session in a private 0600 credentials file.');}
await privateDirectory();try{const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Unsafe credential file.');}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;}
const temporary=join(directory,'.credentials-'+randomUUID());try{const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(token);await handle.sync();}finally{await handle.close();}await rename(temporary,file);}finally{await unlink(temporary).catch(()=>undefined);}}
export async function clearCredential(){try{(await entry()).deletePassword();}catch{/* Absent keychain. */}await unlink(file).catch(()=>undefined);}
