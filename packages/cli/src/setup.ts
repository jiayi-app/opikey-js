/** Agent clients `opi setup` can connect, and how each one stores an HTTP MCP server. Pure functions: no file or process access here. */
export const CLIENTS={
 'claude-code':{label:'Claude Code',kind:'command'},
 vscode:{label:'VS Code',kind:'command'},
 cursor:{label:'Cursor',kind:'json',path:['.cursor','mcp.json'],urlField:'url'},
 windsurf:{label:'Windsurf',kind:'json',path:['.codeium','windsurf','mcp_config.json'],urlField:'serverUrl'},
 gemini:{label:'Gemini CLI',kind:'json',path:['.gemini','settings.json'],urlField:'httpUrl'},
 codex:{label:'Codex',kind:'toml',path:['.codex','config.toml']},
 other:{label:'Agent',kind:'env'},
} as const;
export type ClientId=keyof typeof CLIENTS;
export const SERVER_NAME='opikey';
export function isClient(value:string|undefined):value is ClientId{return value!==undefined&&Object.hasOwn(CLIENTS,value);}

export class ConfigError extends Error{}

/**
 * Add or replace the `opikey` server in a JSON MCP config, keeping everything else.
 * Refuses (throws ConfigError) rather than overwrite a file it can't parse.
 */
export function mergeJsonConfig(existing:string|null,urlField:string,url:string,key:string):{text:string;replaced:boolean}{
 let data:Record<string,unknown>={};
 if(existing!==null&&existing.trim()){let parsed:unknown;try{parsed=JSON.parse(existing);}catch{throw new ConfigError('The existing config file is not plain JSON, so it was left unchanged.');}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new ConfigError('The existing config file has an unexpected shape, so it was left unchanged.');data=parsed as Record<string,unknown>;}
 const servers=data['mcpServers']??{};if(!servers||typeof servers!=='object'||Array.isArray(servers))throw new ConfigError('The existing "mcpServers" entry has an unexpected shape, so the file was left unchanged.');
 const replaced=Object.hasOwn(servers,SERVER_NAME);
 data['mcpServers']={...(servers as Record<string,unknown>),[SERVER_NAME]:{[urlField]:url,headers:{Authorization:`Bearer ${key}`}}};
 return {text:JSON.stringify(data,null,2)+'\n',replaced};
}

/** Add or replace the [mcp_servers.opikey] table in a Codex config.toml, keeping every other line. */
export function mergeCodexToml(existing:string|null,url:string,key:string):{text:string;replaced:boolean}{
 const lines=(existing??'').split('\n');const out:string[]=[];let skipping=false,replaced=false;
 for(const line of lines){const header=line.trim().match(/^\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
  if(header){const name=header[1]??'';skipping=name===`mcp_servers.${SERVER_NAME}`||name.startsWith(`mcp_servers.${SERVER_NAME}.`);if(skipping){replaced=true;continue;}}
  if(!skipping)out.push(line);}
 while(out.length&&out[out.length-1]?.trim()==='')out.pop();
 const block=[`[mcp_servers.${SERVER_NAME}]`,`url = ${JSON.stringify(url)}`,`http_headers = { "Authorization" = ${JSON.stringify(`Bearer ${key}`)} }`];
 return {text:(out.length?out.join('\n')+'\n\n':'')+block.join('\n')+'\n',replaced};
}

/** Arguments for clients configured through their own command line. The key is passed as an argument to a child process, never through a shell. */
export function clientCommand(client:'claude-code'|'vscode',url:string,key:string):{command:string;args:string[];remove?:{command:string;args:string[]}}{
 if(client==='claude-code')return {command:'claude',args:['mcp','add','--transport','http','--scope','user',SERVER_NAME,url,'--header',`Authorization: Bearer ${key}`],remove:{command:'claude',args:['mcp','remove','--scope','user',SERVER_NAME]}};
 return {command:'code',args:['--add-mcp',JSON.stringify({name:SERVER_NAME,type:'http',url,headers:{Authorization:`Bearer ${key}`}})]};
}

export function defaultKeyName(client:ClientId,hostname:string){const host=hostname.replace(/\.local$/i,'').replace(/[^\p{L}\p{N} ._-]/gu,'').slice(0,40)||'this computer';return `${CLIENTS[client].label} on ${host}`.slice(0,80);}
