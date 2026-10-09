// Read-only smoke test of Codex's resolved installed transport, not the source tree.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {access} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const entries=JSON.parse(execFileSync('codex',['mcp','list','--json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
const entry=entries.find(x=>x.name==='openviking-codex-app');
assert.ok(entry?.enabled,'Installed App MCP must be enabled');
const {type,...config}=entry.transport;
assert.equal(type,'stdio');
await access(config.command);await access(config.cwd);await access(config.args[0]);
const client=new Client({name:'installed-app-smoke',version:'1'});
try{
 await client.connect(new StdioClientTransport({...config,env:{HOME:process.env.HOME,PATH:'/usr/bin:/bin',...config.env}}));
 const {tools}=await client.listTools();
 const cardTools=tools.filter(t=>t._meta?.ui?.resourceUri||t._meta?.['ui/resourceUri']).map(t=>t.name);
 for(const name of ['show_onboarding','prepare_collaboration','review_import','publish_work','publish_report'])assert.ok(cardTools.includes(name),name+' must carry an App resource');
 assert.equal(tools.find(t=>t.name==='show_workspace')._meta,undefined);
 assert.equal(tools.find(t=>t.name==='list_bound_users')._meta,undefined);
 assert.ok(cardTools.includes('show_bound_users'));
 const sidebar=tools.find(t=>t.name==='open_workspace');
 assert.equal(sidebar.title,'OpenViking');
 assert.deepEqual(sidebar._meta['openai/ui'].entrypoints,[{type:'global'}]);
 assert.deepEqual(sidebar._meta.ui.visibility,['app']);
 const workspace=await client.readResource({uri:sidebar._meta.ui.resourceUri});
 assert.equal(workspace.contents[0].mimeType,'text/html;profile=mcp-app');
 const workspaceState=await client.callTool({name:'get_workspace_state',arguments:{}});
 assert.ok(!workspaceState.isError);
 assert.equal(workspaceState.structuredContent.onboarding,undefined);
 const users=await client.callTool({name:'list_bound_users',arguments:{}});
 assert.ok(!users.isError);assert.equal(users.structuredContent.view,undefined);
 const result=await client.callTool({name:'show_onboarding',arguments:{step:'connection'}});
 assert.ok(!result.isError);assert.equal(result.structuredContent.view,'onboarding');assert.equal(result.structuredContent.connection.ready,false);
 const resource=await client.readResource({uri:'ui://openviking/personal.html'});
 assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
 console.log(JSON.stringify({installedTransport:'passed',minimalPath:'passed',version:result.structuredContent.runtimeVersion,cardTools,connectionCardPayload:'passed',htmlResource:'passed',globalEntrypoint:'passed',independentWorkspaceResource:'passed',codexNativeRendering:'not_verified'},null,2));
}finally{await client.close();}
