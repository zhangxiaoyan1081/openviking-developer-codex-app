import { App } from '@modelcontextprotocol/ext-apps';
import {createWorkspace} from './workspace-users.mjs';

// Global navigation has no preceding model turn or guaranteed tool-result event.
// Bootstrap through the MCP bridge after initialization, including on refresh.
const app=new App({name:'OpenViking',version:'0.2.9'},{},{autoResize:false});
document.querySelector('header small').textContent='工作台';
const call=async(name,args)=>{
 const result=await app.callServerTool({name,arguments:args});
 if(result.isError)throw Error(result.content?.[0]?.text||'读取失败，请重试。');
 return result.structuredContent||result;
};
const ui=createWorkspace({transport:call,sendNew:async text=>{if(!app.getHostCapabilities()?.experimental?.['openai/message'])throw Error('新对话不可用');const result=await app.sendMessage({role:'user',content:[{type:'text',text}],_meta:{'openai/message':{target:'new'}}});if(result?.isError)throw Error('发送失败');}});
let settled=false;
const timer=setTimeout(()=>{settled=true;ui.fail('加载超时，请重试。');},15000);
app.onerror=()=>{settled=true;clearTimeout(timer);ui.fail('连接已中断，请重新加载。');};
async function start(){try{
 await app.connect();
 await ui.start();
 if(!settled){settled=true;clearTimeout(timer);}
}catch(e){if(!settled){settled=true;clearTimeout(timer);ui.fail(e.message||'无法连接，请重试。');}}

}
start();
