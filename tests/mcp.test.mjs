import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('bundled MCP: app metadata, isolated startup, HTML resource, schema rejection',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'ov-mcp-'));
 const client=new Client({name:'test',version:'1.0.0'});
 const transport=new StdioClientTransport({command:'node',args:[path.resolve('plugins/openviking-codex-app/scripts/app_server.mjs')],env:{PATH:process.env.PATH,HOME:temp}});
 try{
  await client.connect(transport);
  const {tools}=await client.listTools();assert.equal(tools.length,10);
  assert.deepEqual(tools.filter(t=>t._meta?.ui?.resourceUri||t._meta?.['ui/resourceUri']).map(t=>t.name).sort(),['review_import','show_onboarding','show_workspace']);
  for(const name of ['get_state','publish_report','open_workspace_panel'])assert.equal(tools.find(t=>t.name===name)._meta,undefined);
  const state=await client.callTool({name:'get_state',arguments:{}});assert.equal(state.structuredContent.view,undefined);
  assert.deepEqual(tools.find(x=>x.name==='confirm_import')._meta.ui.visibility,['app']);
  const result=await client.callTool({name:'show_onboarding',arguments:{}});
  assert.equal(result.isError,undefined);assert.equal(result.structuredContent.view,'onboarding');assert.equal(result.structuredContent.configured,false);
  const resource=await client.readResource({uri:'ui://openviking/personal.html'});
  assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(resource.contents[0].text,/带上过去的工作/);
  assert.ok(!resource.contents[0].text.includes('api_key'));
  const invalid=await client.callTool({name:'select_scope',arguments:{mode:'recent',days:120}});assert.equal(invalid.isError,true);
 }finally{await client.close();await rm(temp,{recursive:true,force:true});}
});
