#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {hostname} from 'node:os';
import {cli,type CliIO} from './core.js';
import {readCredential,saveCredential,clearCredential} from './credentials.js';
const io:CliIO={hostname:hostname(),out:text=>process.stdout.write(text+'\n'),err:text=>process.stderr.write(text+'\n'),read:readCredential,save:token=>saveCredential(token,text=>process.stderr.write(text+'\n')),clear:clearCredential,open:url=>{const executable=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const child=spawn(executable,args,{stdio:'ignore',detached:true});child.on('error',()=>undefined);child.unref();},run:(command,args,env)=>new Promise(resolve=>{const child=spawn(command,args,{env,stdio:'inherit',shell:false});const signals=['SIGINT','SIGTERM','SIGHUP'] as const;const handlers=signals.map(signal=>{const handler=()=>{child.kill(signal);};process.on(signal,handler);return {signal,handler};});const cleanup=()=>handlers.forEach(({signal,handler})=>process.off(signal,handler));child.on('error',()=>{cleanup();resolve(1);});child.on('exit',(code,signal)=>{cleanup();resolve(code??(signal==='SIGINT'?130:signal==='SIGTERM'?143:1));});})};
// Typed confirmations for AI mode previews. Only on an interactive terminal; otherwise the CLI prints the confirm id and exits 2.
io.prompt=async question=>{if(!process.stdin.isTTY||!process.stderr.isTTY)return null;const rl=createInterface({input:process.stdin,output:process.stderr});try{return await rl.question(question);}catch{return null;}finally{rl.close();}};
const argv=process.argv.slice(2);
// Requests that can take a while stop cleanly on Ctrl+C. `opi run` keeps forwarding signals to its child.
const LOCAL=new Set(['login','logout','whoami','apis','vault','run','usage','credits','help','--help','-h','version','--version','-v']);
if(argv[0]!==undefined&&!LOCAL.has(argv[0])){const controller=new AbortController();io.signal=controller.signal;process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());}
try{process.exitCode=await cli(argv,io,process.env);}catch{if(io.signal?.aborted){process.exitCode=130;}else{io.err('OPI command failed. Check your OPI Key, its access and your connection.');process.exitCode=1;}}
