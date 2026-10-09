import {createWorkspace} from './workspace-users.mjs';
document.querySelector('header small').textContent='工作台';
const transport=async(name,args={})=>{
 const paths={get_workspace_state:'/api/workspace_state',workspace_read:'/api/workspace_read',workspace_switch_user:'/api/workspace_switch'};
 const response=await fetch(paths[name],{method:'POST',headers:{'Content-Type':'application/json','X-OV-Token':document.querySelector('meta[name=ov-token]').content},body:JSON.stringify(args)});
 const value=await response.json();if(!response.ok||value.error)throw Error(value.error||'读取失败。');return value;
};
const ui=createWorkspace({transport});ui.start().catch(e=>ui.fail(e.message));
