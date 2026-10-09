import { App } from '@modelcontextprotocol/ext-apps';
import { createUI } from './ui.mjs';

// Global navigation has no preceding model turn or guaranteed tool-result event.
// Bootstrap through the MCP bridge after initialization, including on refresh.
const app=new App({name:'OpenViking',version:'0.2.8'},{},{autoResize:false});
document.querySelector('header small').textContent='工作台';
const call=async(name,args)=>{
 const result=await app.callServerTool({name,arguments:args});
 if(result.isError)throw Error(result.content?.[0]?.text||'读取失败，请重试。');
 return result.structuredContent||result;
};
const ui=createUI({call,panel:true,initialPage:'files',stateTool:'get_workspace_state',failureTitle:'工作台暂时无法显示'});
let settled=false;
const timer=setTimeout(()=>{settled=true;ui.fail('加载超时，请重试。');},15000);
app.onerror=()=>{settled=true;clearTimeout(timer);ui.fail('连接已中断，请重新加载。');};
async function start(){try{
 await app.connect();
 const state=await call('get_workspace_state',{});
 if(!settled){settled=true;clearTimeout(timer);ui.render({...state,view:'workspace'});}
}catch(e){if(!settled){settled=true;clearTimeout(timer);ui.fail(e.message||'无法连接，请重试。');}}

}
start();
