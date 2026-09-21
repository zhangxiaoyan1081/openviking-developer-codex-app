import { readFile,writeFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Codex can replace a plugin cache while an existing task keeps its MCP process.
// Pin code/assets before serving calls, and never inherit the removable cache cwd.
// This snapshot contains distributable files only, no user config or credentials.
export async function pinRuntime(source){
 const files=['scripts/app_backend.py','scripts/cloud.py','scripts/connection.py','scripts/history.py','scripts/onboarding.py','scripts/panel.py','scripts/workspace.py','assets/app.html','assets/index.html'];
 const [manifest,...contents]=await Promise.all([readFile(path.join(source,'.codex-plugin/plugin.json'),'utf8'),...files.map(file=>readFile(path.join(source,file)))]);
 const root=await mkdtemp(path.join(tmpdir(),'openviking-codex-app-runtime-'));
 try{
  await Promise.all(['scripts','assets'].map(dir=>mkdir(path.join(root,dir),{mode:0o700})));
  await Promise.all(files.map((file,i)=>writeFile(path.join(root,file),contents[i],{mode:0o600})));
  return {root,version:JSON.parse(manifest).version};
 }catch(error){await rm(root,{recursive:true,force:true});throw error;}
}
