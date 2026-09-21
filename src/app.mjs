import { App } from '@modelcontextprotocol/ext-apps';
import { createUI } from './ui.mjs';
const app=new App({name:'OpenViking',version:'0.2.0'},{},{autoResize:true});
const ui=createUI({
 call:async(name,args)=>{const r=await app.callServerTool({name,arguments:args});if(r.isError)throw Error(r.content?.[0]?.text||'操作未完成。');return r.structuredContent||r;},
 send:async text=>{const r=await app.sendMessage({role:'user',content:[{type:'text',text}]});if(r.isError)throw Error('发送未完成。');},
 expand:()=>app.requestDisplayMode({mode:'fullscreen'})
});
let received=false;
const timer=setTimeout(()=>{if(!received)ui.fail('加载超时，请重试。');},12000);
function failed(text){clearTimeout(timer);ui.fail(text);}
app.ontoolresult=result=>{
 clearTimeout(timer);
 if(result.isError){failed('操作未完成，请重试。');return;}
 let value=result.structuredContent;
 if(!value){
  for(const item of result.content||[]){
   if(item.type==='text'){try{const parsed=JSON.parse(item.text);if(parsed?.view){value=parsed;break;}}catch{}}
  }
 }
 if(!['onboarding','workspace'].includes(value?.view)){failed('未收到卡片内容，请重试。');return;}
 try{ui.render(value);received=true;}catch{failed('卡片内容无法显示，请重试。');}
};
app.onerror=()=>{if(received)ui.error('连接已中断，请在对话中重新打开卡片。');else failed('连接已中断，请重试。');};
app.connect().catch(()=>failed('无法连接，请重试。'));
