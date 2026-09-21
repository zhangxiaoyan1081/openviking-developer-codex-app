import { build } from 'esbuild';
import { readFile,writeFile } from 'node:fs/promises';
const destination='plugins/openviking-codex-app';
const server=await build({entryPoints:['src/server.mjs'],outfile:`${destination}/scripts/app_server.mjs`,bundle:true,metafile:true,platform:'node',format:'esm',target:'node22',minify:true,charset:'utf8',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},legalComments:'eof'});
const browser=await build({entryPoints:['src/app.mjs'],bundle:true,metafile:true,platform:'browser',format:'iife',target:'es2022',minify:true,charset:'utf8',write:false,legalComments:'eof'});
const logo=await readFile(`${destination}/assets/openviking.svg`);
const template=(await readFile('src/shell.html','utf8')).replace('__OPENVIKING_LOGO__',`data:image/svg+xml;base64,${logo.toString('base64')}`);
await writeFile(`${destination}/assets/app.html`,template.replace('/* APP */',()=>browser.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')));
const panel=await build({entryPoints:['src/panel.mjs'],bundle:true,metafile:true,platform:'browser',format:'iife',target:'es2022',minify:true,charset:'utf8',write:false});
await writeFile(`${destination}/assets/index.html`,template.replace('/* APP */',()=>panel.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')));

const packages=new Set(Object.keys({...server.metafile.inputs,...browser.metafile.inputs,...panel.metafile.inputs}).map(p=>p.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
const notices=[];
for(const name of [...packages].sort()){
 const pkg=JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8'));
 let license='';
 for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md']){
  try{license=await readFile(`node_modules/${name}/${file}`,'utf8');break;}catch{}
 }
 if(!license)throw Error(`License file missing: ${name}`);
 notices.push(`${name}@${pkg.version} (${pkg.license})\n${license}`);
}
await writeFile(`${destination}/THIRD_PARTY_NOTICES.txt`,notices.join('\n\n========================================\n\n'));
