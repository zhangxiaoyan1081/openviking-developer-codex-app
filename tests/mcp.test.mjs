import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp,rm,cp,mkdir,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
test('bundled MCP: app metadata, isolated startup, HTML resource, schema rejection',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'ov-mcp-'));
 const client=new Client({name:'test',version:'1.0.0'});
 const transport=new StdioClientTransport({command:'node',args:[path.resolve('plugins/openviking-codex-app/scripts/app_server.mjs')],env:{PATH:process.env.PATH,HOME:temp}});
 try{
  await client.connect(transport);
  const {tools}=await client.listTools();assert.equal(tools.length,20);
  assert.deepEqual(tools.filter(t=>t._meta?.ui?.resourceUri||t._meta?.['ui/resourceUri']).map(t=>t.name).sort(),['prepare_collaboration','publish_report','publish_work','review_import','show_onboarding']);
  for(const name of ['get_state','open_workspace_panel','show_workspace'])assert.equal(tools.find(t=>t.name===name)._meta,undefined);
  const state=await client.callTool({name:'get_state',arguments:{}});assert.equal(state.structuredContent.view,undefined);
  assert.deepEqual(tools.find(x=>x.name==='confirm_import')._meta.ui.visibility,['app']);
  const result=await client.callTool({name:'show_onboarding',arguments:{}});
  assert.equal(result.isError,undefined);assert.equal(result.structuredContent.view,'onboarding');assert.equal(result.structuredContent.configured,false);assert.equal(result.structuredContent.connection.ready,false);
  for(const name of ['connect_key','connect_existing'])assert.deepEqual(tools.find(x=>x.name===name)._meta.ui.visibility,['app']);
  const resource=await client.readResource({uri:'ui://openviking/personal.html'});
  assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(resource.contents[0].text,/带上过去的工作/);
  assert.ok(!resource.contents[0].text.includes('test-only'));
  const invalid=await client.callTool({name:'select_scope',arguments:{mode:'recent',days:120}});assert.equal(invalid.isError,true);
 }finally{await client.close();await rm(temp,{recursive:true,force:true});}
});

test('MCP cards and stdin fallback share rule approval, readback and skip continuation',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'ov-flow-'));
 const scripts=path.resolve('plugins/openviking-codex-app/scripts');
 const env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp};
 const python=(code)=>execFileSync('python3',['-c',code],{env,encoding:'utf8'});
 python(`import sys;sys.path.insert(0,${JSON.stringify(scripts)});import cloud;cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'fixture-key'});cloud.save('connection.json',{'verifiedAt':'2026-09-21T00:00:00Z'})`);
 const client=new Client({name:'flow-test',version:'1'});
 try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(scripts,'app_server.mjs')],env}));
  const initial=await client.callTool({name:'get_state',arguments:{}});assert.equal(initial.structuredContent.onboarding.phase,'collaboration');
  const connection=await client.callTool({name:'show_onboarding',arguments:{step:'connection'}});
  assert.equal(connection.structuredContent.connection.ready,false);
  assert.equal(connection.structuredContent.connection.canReuse,true);
  const draft=await client.callTool({name:'prepare_collaboration',arguments:{path:path.join(temp,'AGENTS.md'),mode:'merge',scope:'global',summary:['保存批准的重要产出'],block:'Save approved deliverables.'}});
  assert.equal(draft.structuredContent.view,'onboarding');
  const revision=draft.structuredContent.onboarding.collaboration.revision;
  const blocked=await client.callTool({name:'select_scope',arguments:{mode:'skip'}});assert.equal(blocked.isError,true);
  await client.callTool({name:'choose_collaboration',arguments:{revision,choice:'adopt'}});
  const applied=JSON.parse(execFileSync('python3',[path.join(scripts,'onboarding.py'),'apply_rules'],{env,input:JSON.stringify({revision}),encoding:'utf8'}));assert.equal(applied.status,'active');
  const skip=await client.callTool({name:'select_scope',arguments:{mode:'skip'}});
  assert.equal(skip.structuredContent.onboarding.phase,'ready');assert.equal(skip.structuredContent.onboarding.choice,null);
  const next=await client.callTool({name:'choose_next',arguments:{choice:'later'}});assert.equal(next.structuredContent.onboarding.choice,'later');
  const persisted=JSON.parse(execFileSync('python3',[path.join(scripts,'app_backend.py'),'state'],{env,input:'{}',encoding:'utf8'}));assert.equal(persisted.onboarding.choice,'later');
  await client.callTool({name:'select_scope',arguments:{mode:'recent',days:30}});
  const selected=await client.callTool({name:'get_state',arguments:{}});
  const summary=await client.callTool({name:'publish_work',arguments:{onboarding:true,scopeRevision:selected.structuredContent.onboarding.scopeRevision,works:[{id:'fixture',title:'Test work',goal:'Finish design',state:'Design reviewed',next:'Check implementation',coverage:'Fixture only',sources:[{label:'Source',uri:'viking://user/default/resources/test.md'}]}]}});
  assert.equal(summary.isError,undefined);assert.equal(summary.structuredContent.view,'onboarding');assert.equal(summary.structuredContent.onboarding.phase,'ready');
  assert.equal(summary.structuredContent.workspace.works[0].title,'Test work');
  const report=await client.callTool({name:'publish_report',arguments:{id:'fixture',kind:'weekly',title:'Test report',period:'Fixture week',body:'Test body',coverage:'Fixture only',sources:[{label:'Source',uri:'viking://user/default/resources/test.md'}]}});
  assert.equal(report.isError,undefined);assert.equal(report.structuredContent.view,'workspace');assert.equal(report.structuredContent.reports[0].body,'Test body');
  assert.ok(!JSON.stringify(next).includes('fixture-key'));
 }finally{await client.close();await rm(temp,{recursive:true,force:true});}
});

test('installed launch survives cache removal before startup and a minimal desktop PATH',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'ov-installed-'));
 const dest=path.join(temp,'marketplace'),cache=path.join(temp,'codex-cache');
 const code=`import importlib.util,pathlib,shutil;spec=importlib.util.spec_from_file_location('installer',${JSON.stringify(path.resolve('install.py'))});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);dest=pathlib.Path(${JSON.stringify(dest)});shutil.copytree(m.ROOT/'plugins',dest/'plugins');m.stage_companion(dest)`;
 execFileSync('python3',['-c',code]);
 await cp(path.join(dest,'plugins/openviking-codex-app'),cache,{recursive:true});
 const config=JSON.parse(await readFile(path.join(cache,'.mcp.json'),'utf8')).mcpServers['openviking-codex-app'];
 // Desktop may retain this config after an upgrade removes its old cache.
 await rm(cache,{recursive:true,force:true});await rm(dest,{recursive:true,force:true});
 const client=new Client({name:'installed-launch',version:'1'});
 try{
  await client.connect(new StdioClientTransport({...config,env:{PATH:'/usr/bin:/bin',HOME:temp,TMPDIR:temp,...config.env}}));
  const result=await client.callTool({name:'show_onboarding',arguments:{step:'connection'}});
  assert.equal(result.isError,undefined);assert.equal(result.structuredContent.connection.ready,false);
  assert.match((await client.readResource({uri:'ui://openviking/personal.html'})).contents[0].text,/连接 OpenViking/);
 }finally{await client.close();await rm(temp,{recursive:true,force:true});}
});

test('a live installed MCP survives plugin cache removal, including a deleted working directory',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'ov-upgrade-'));
 const cache=path.join(temp,'old-cache');await cp(path.resolve('plugins/openviking-codex-app'),cache,{recursive:true});
 const home=path.join(temp,'home');await mkdir(home);
 const client=new Client({name:'upgrade-test',version:'1.0.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:['scripts/app_server.mjs'],cwd:cache,env:{PATH:process.env.PATH,HOME:home,TMPDIR:temp}});
 try{
  await client.connect(transport);
  const first=await client.callTool({name:'show_onboarding',arguments:{}});assert.equal(first.isError,undefined);
  const html=await client.readResource({uri:'ui://openviking/personal.html'});
  await rm(cache,{recursive:true,force:true});
  const next=await client.callTool({name:'show_onboarding',arguments:{}});
  assert.equal(next.isError,undefined);assert.equal(next.structuredContent.view,'onboarding');
  assert.equal(next.structuredContent.runtimeVersion,first.structuredContent.runtimeVersion);
  assert.deepEqual(await client.readResource({uri:'ui://openviking/personal.html'}),html);
  const state=await client.callTool({name:'get_state',arguments:{}});assert.equal(state.isError,undefined);
 }finally{await client.close();await rm(temp,{recursive:true,force:true});}
});
