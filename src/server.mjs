import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const resource='ui://openviking/personal.html';
const server=new McpServer({name:'openviking-personal',version:'0.2.0'});
function backend(action,args={}){return new Promise((resolve,reject)=>{
 const child=execFile('python3',[path.join(root,'scripts/app_backend.py'),action],{timeout:60000,maxBuffer:4*1024*1024},(err,out)=>{
  try{const result=JSON.parse(out);if(err||result.error)reject(new Error(result.error||'操作未完成。'));else resolve(result);}catch{reject(new Error('操作未完成，请重试。'));}
 });child.stdin.end(JSON.stringify(args));
});}
function output(value){return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
function tool(name,description,schema,action,{view,appOnly=false,readOnly=false}={}){
 registerAppTool(server,name,{description,inputSchema:schema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:!['state','scope','confirm','review','publish_report'].includes(action)},_meta:{ui:{resourceUri:resource,visibility:appOnly?['app']:['model','app']}}},async(args)=>{
  try{return output({...await backend(action,args),...(view?{view}:{})});}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
 });
}
tool('show_onboarding','展示接入卡片，让用户选择近期工作、项目或描述范围。不要为 onboarding 打开浏览器。',{},'state',{view:'onboarding',readOnly:true});
tool('show_workspace','展示个人工作台：进展、目录、日报周报和知识洞察。',{},'state',{view:'workspace',readOnly:true});
tool('get_state','读取用户选择、清单确认及工作台状态。',{},'state',{readOnly:true});
tool('select_scope','保存同步范围；不上传。用户点击后由 App 发消息请 Agent 准备清单。',{mode:z.enum(['recent','projects','description','skip']),days:z.union([z.literal(7),z.literal(30),z.literal(90)]).optional(),text:z.string().max(2000).optional()},'scope',{appOnly:true});
tool('review_import','读取本地历史计划，展示完整待同步清单，用户确认之前不得上传。coverage 必须说明覆盖范围及缺口。',{path:z.string(),coverage:z.string().min(1)},'review',{view:'onboarding'});
tool('confirm_import','用户点击确认后保存清单 hash；不自动上传。',{hash:z.string().regex(/^[a-f0-9]{64}$/)},'confirm',{appOnly:true});
tool('list_directory','列出个人空间目录。',{uri:z.string()},'list',{appOnly:true,readOnly:true});
tool('read_file','读取个人资料，每次最多 200 行。',{uri:z.string(),offset:z.number().int().nonnegative().default(0)},'read',{appOnly:true,readOnly:true});
tool('publish_report','将依据真实资料生成并已在 OV 归档读回的报告发布到个人工作台。不能把模板或推测当成实际进展。',{id:z.string(),kind:z.enum(['progress','daily','weekly','insight']),title:z.string(),period:z.string(),body:z.string().max(200000),coverage:z.string(),sources:z.array(z.object({label:z.string(),uri:z.string()})).min(1)},'publish_report');
tool('open_workspace_panel','用户要在侧边栏打开工作台时取得本地 URL，再用 open_in_codex 打开；不要用于接入引导。',{},'panel');
registerAppResource(server,'OpenViking',resource,{},async()=>({contents:[{uri:resource,mimeType:RESOURCE_MIME_TYPE,text:await readFile(path.join(root,'assets/app.html'),'utf8'),_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}}}}]}));
await server.connect(new StdioServerTransport());
