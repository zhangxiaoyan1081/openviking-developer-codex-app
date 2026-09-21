import { App } from '@modelcontextprotocol/ext-apps';
import { createUI } from './ui.mjs';
const app=new App({name:'OpenViking',version:'0.2.0'},{},{autoResize:true});
const ui=createUI({
 call:async(name,args)=>{const r=await app.callServerTool({name,arguments:args});if(r.isError)throw Error(r.content?.[0]?.text||'操作未完成。');return r.structuredContent||r;},
 send:async text=>{const r=await app.sendMessage({role:'user',content:[{type:'text',text}]});if(r.isError)throw Error('发送未完成。');},
 expand:()=>app.requestDisplayMode({mode:'fullscreen'})
});
app.ontoolresult=result=>{if(result.isError){ui.error('操作未完成，请重试。');return;}if(result.structuredContent?.view)ui.render(result.structuredContent);};
app.onerror=()=>ui.error('连接已中断，请在对话中重新打开卡片。');
app.connect().catch(()=>ui.error('卡片无法连接，请在对话中继续接入。'));
