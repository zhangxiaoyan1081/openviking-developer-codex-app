import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pinRuntime } from './runtime.mjs';
const runtimeId=randomUUID();
const startedAt=String(Date.now()/1000);
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {root,version}=await pinRuntime(source);
const resource='ui://openviking/personal.html';
const server=new McpServer({name:'openviking-codex-app',version});
function backend(action,args={}){return new Promise((resolve,reject)=>{
 const child=execFile(process.env.OV_APP_PYTHON||'python3',[path.join(root,'scripts/app_backend.py'),action],{cwd:root,env:{...process.env,OV_APP_RUNTIME_ID:runtimeId,OV_APP_STARTED_AT:startedAt},timeout:60000,maxBuffer:4*1024*1024},(err,out)=>{
  try{const result=JSON.parse(out);if(err||result.error)reject(new Error(result.error||'操作未完成。'));else resolve(result);}catch{const code=err?.code==='ENOENT'?'PYTHON_UNAVAILABLE':err?.killed?'BACKEND_TIMEOUT':'BACKEND_FAILED';const message=code==='PYTHON_UNAVAILABLE'?'未找到 Python 3，请安装后重新打开 Codex。':code==='BACKEND_TIMEOUT'?'连接响应超时，请稍后重试。':'接入服务未能运行，请重新打开 Codex 后再试。';reject(Object.assign(new Error(message),{code}));}
 });child.stdin.end(JSON.stringify(args));
});}
function output(value){value={...value,runtimeVersion:version};return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
function tool(name,description,schema,action,{view,appOnly=false,readOnly=false}={}){
 const config={description,inputSchema:schema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:!['state','scope','confirm','review','publish_report'].includes(action)}};
 // Present user-facing results directly; do not rely on a second model call.
 // Background reads and App callbacks do not create extra cards.
 if(view)config._meta={ui:{resourceUri:resource,visibility:['model','app']}};
 else if(appOnly)config._meta={ui:{visibility:['app']}};
 const handler=async(args)=>{
  try{return output({...await backend(action,args),...(view?{view:typeof view==='function'?view(args):view}:{})});}catch(e){return {isError:true,content:[{type:'text',text:e.message}],structuredContent:{error:{code:e.code||'OPERATION_FAILED',message:e.message},runtimeVersion:version}};}
 };
 if(view)registerAppTool(server,name,config,handler);
 else server.registerTool(name,config,handler);
}
tool('show_onboarding','展示接入卡片。新的接入请求且未提供 Key 时用 step=connection 展示当前连接选择；接续已有流程用 current。覆盖连接、协作方式、范围、整理进度和摘要，不用浏览器或原生单选替代可用卡片。',{step:z.enum(['current','connection']).default('current')},'onboarding_view',{view:'onboarding',readOnly:true});
tool('show_workspace','打开 OpenViking 工作台：返回侧边栏 URL。随后必须用 open_in_codex placement=right 打开；不生成工作台卡片。',{},'panel');
tool('get_state','读取用户选择、清单确认及工作台状态。',{},'state',{readOnly:true});
tool('connect_existing','用户选择使用本机连接后验证并确认，不回显凭据。',{revision:z.string()},'connect_existing',{appOnly:true});
tool('connect_key','验证用户在卡片输入的 Key，成功后更新官方配置；失败保留旧连接，不回显 Key。',{revision:z.string(),api_key:z.string().min(1).max(8192)},'connect_key',{appOnly:true});
tool('select_scope','保存同步范围；不上传。用户点击后由 App 发消息请 Agent 准备清单。',{mode:z.enum(['recent','projects','description','skip']),days:z.union([z.literal(7),z.literal(30),z.literal(90)]).optional(),text:z.string().max(2000).optional()},'scope',{appOnly:true});
tool('review_import','读取本地历史计划，展示完整待同步清单，用户确认之前不得上传。coverage 必须说明覆盖范围及缺口。',{path:z.string(),coverage:z.string().min(1)},'review',{view:'onboarding'});
tool('confirm_import','用户点击确认后保存清单 hash；不自动上传。',{hash:z.string().regex(/^[a-f0-9]{64}$/)},'confirm',{appOnly:true});
tool('prepare_collaboration','检查实际生效 AGENTS.md 和覆盖规则后准备协作设置。reuse 用于已有同等授权并提供 evidence，但仍展示沿用/调整选择，不自动确认；merge 只准备管理块，用户确认后由 Agent 调用 onboarding.py apply_rules 保存。',{path:z.string(),mode:z.enum(['reuse','merge']),scope:z.enum(['global','project']),summary:z.array(z.string().min(1)).min(1).max(8),block:z.string().optional(),evidence:z.string().optional(),check_files:z.array(z.string()).optional()},'rules_prepare',{view:'onboarding'});
tool('choose_collaboration','用户选择采用或调整已展示的协作方式。',{revision:z.string(),choice:z.enum(['adopt','adjust'])},'rules_choose',{appOnly:true});
tool('import_status','查询当前已确认导入的抽取状态；仅检查状态，不重新导入。',{jobId:z.string().regex(/^[a-f0-9]{64}$/)},'import_status',{readOnly:true});
tool('choose_next','保存用户在接续摘要或使用说明中选择的下一步。',{choice:z.enum(['start','save','later','continue','correct'])},'next',{appOnly:true});
tool('publish_work','发布已经核对并归档读回的接续摘要。onboarding=true 时传入准备摘要前 get_state.onboarding.scopeRevision，且目标、进展、下一步、覆盖和来源必填。本次范围汇总后调用一次，返回独立摘要卡；不要为轮询同步状态重复调用或再 show_onboarding。',{onboarding:z.boolean().default(false),scopeRevision:z.string().optional(),works:z.array(z.object({id:z.string(),title:z.string(),project:z.string().optional(),goal:z.string().optional(),state:z.string(),decisions:z.string().optional(),openIssues:z.string().optional(),next:z.string(),coverage:z.string(),sources:z.array(z.object({label:z.string(),uri:z.string()})).min(1)}))},'publish_work',{view:args=>args.onboarding?'onboarding':'workspace'});
tool('list_directory','列出当前公有云 Key 有权访问的目录，从 viking:// 根目录开始。',{uri:z.string()},'list',{appOnly:true,readOnly:true});
tool('tree_directory','读取公有云目录树，最多两层、200 个节点；深入目录用 list_directory。',{uri:z.string().default('viking://')},'tree',{appOnly:true,readOnly:true});
tool('read_file','读取当前公有云 Key 有权访问的文件，每次最多 200 行，支持原生图片内容。',{uri:z.string(),offset:z.number().int().nonnegative().default(0)},'read',{appOnly:true,readOnly:true});
tool('publish_report','将依据真实资料生成并已在 OV 归档读回的报告发布到个人工作台。不能把模板或推测当成实际进展。',{id:z.string(),kind:z.enum(['progress','daily','weekly','insight']),title:z.string(),period:z.string(),body:z.string().max(200000),coverage:z.string(),sources:z.array(z.object({label:z.string(),uri:z.string()})).min(1)},'publish_report',{view:'workspace'});
tool('open_workspace_panel','用户要求打开工作台时取得本地 URL，随后必须用 open_in_codex placement=right 打开，不展示工作台卡片；不要用于接入引导。',{},'panel');
registerAppResource(server,'OpenViking',resource,{},async()=>({contents:[{uri:resource,mimeType:RESOURCE_MIME_TYPE,text:await readFile(path.join(root,'assets/app.html'),'utf8'),_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}}}}]}));
await server.connect(new StdioServerTransport());
