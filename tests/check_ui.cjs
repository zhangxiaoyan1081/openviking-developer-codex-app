const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../plugins/ov-personal/assets/index.html'),'utf8');
const code=html.split('<script>')[1].split('</script>')[0];new Function(code);
const nodes=new Map(),make=()=>({innerHTML:'',textContent:'',value:'',open:false,classList:{toggle(){}},showModal(){this.open=true},close(){this.open=false},focus(){},select(){},setAttribute(){}});
const ctx=vm.createContext({console,URL,encodeURIComponent,document:{querySelector(s){if(!nodes.has(s))nodes.set(s,make());return nodes.get(s)},querySelectorAll(){return[]},addEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}},fetch:async()=>({ok:true,json:async()=>({connected:true,workspace:{works:[]}})})});
vm.runInContext(code,ctx);
setImmediate(()=>{
 assert.match(nodes.get('#main').innerHTML,/近期全部工作/);assert.match(nodes.get('#main').innerHTML,/选择项目/);assert.match(nodes.get('#main').innerHTML,/描述范围/);
 vm.runInContext("choose('recent')",ctx);assert.match(nodes.get('#dialog-body').innerHTML,/data-days="90"/);
 vm.runInContext("state.scope={mode:'recent',days:90};work()",ctx);assert.match(nodes.get('#main').innerHTML,/等待|核对/);
 vm.runInContext("state.workspace={works:[{title:'<script>alert(1)</script>',state:'已完成',next:'继续',sources:[{uri:'viking://user/default/resources/a.md',label:'报告'}]}]};work()",ctx);
 assert.ok(!nodes.get('#main').innerHTML.includes('<script>'));assert.match(nodes.get('#main').innerHTML,/查看依据/);
 assert.ok(!html.includes('团队总览'));assert.ok(!html.includes('Computer History'));
 console.log('UI: scope choices, 90 days, selection-not-upload, source cards and escaping passed.');
});
