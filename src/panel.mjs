import {createUI} from './ui.mjs';
const endpoints={get_state:'/api/state',list_directory:'/api/list',read_file:'/api/read'};
const call=async(name,args)=>{const response=await fetch(endpoints[name]+'?'+new URLSearchParams(args));const value=await response.json();if(!response.ok||value.error)throw Error(value.error||'读取失败。');return value;};
const ui=createUI({call,panel:true});
call('get_state',{}).then(value=>ui.render({...value,view:'workspace'})).catch(e=>ui.error(e.message));
