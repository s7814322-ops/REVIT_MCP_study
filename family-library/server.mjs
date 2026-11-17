import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildCatalog, sourceFolder} from './build-catalog.mjs';
import {librarySources} from './sources.mjs';
import {listFamilyFiles} from './source-files.mjs';
import {createSettings} from './settings.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export function startLibrary({source, sources = source ? [{id:'doors',label:path.basename(source),path:source}] : librarySources,
  dist = path.join(root,'dist'), metadataRoot = root,
  port = 4318, pollMs = 2000, settleMs = 1200,configPath=path.join(metadataRoot,'sources.local.json')} = {}) {
let catalog = fs.existsSync(path.join(dist,'catalog.json')) ? JSON.parse(fs.readFileSync(path.join(dist, 'catalog.json'), 'utf8')) : {items:[],sources:[],source:'',generated:new Date().toISOString(),revision:'unconfigured'};
let families = new Map(catalog.items.map(item => [item.id, item]));
const marker=path.join(metadataRoot,'.program-version');
const programVersion=fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim():'development';
let applied = null, candidate = null, candidateSince = 0;
let sync = {state:'checking',lastChecked:null,error:null,pendingIds:[]};
function markPending() {
  sync.pendingIds=catalog.items.filter(item=>{
    try { return crypto.createHash('sha256').update(fs.readFileSync(item.path)).digest('hex') !== item.sourceHash; }
    catch { return true; }
  }).map(item=>item.id);
}
function publicCatalog() {
  if (!sync.pendingIds.length) return catalog;
  const pending=new Set(sync.pendingIds);
  return {...catalog,revision:catalog.revision+':pending:'+sync.pendingIds.join(','),items:catalog.items.map(item=>
    pending.has(item.id) ? {...item,model:undefined,typeModels:undefined,preview:null,modelPending:true,
      modelStatus:'待重新匯出：來源檔案變更中，等待資料讀取完成。'} : item)};
}
function fingerprint() {
  const files = sources.flatMap(origin=>listFamilyFiles(origin).map(file=>file.fullPath));
  files.push(...['models-index.json','type-models-index.json','rendered-previews.json'].map(name => path.join(metadataRoot,name)));
  return JSON.stringify(files.map(file => {
    try { const s=fs.statSync(file); return [file,s.size,s.mtimeMs,s.ctimeMs]; }
    catch (error) { if (error.code === 'ENOENT' && !/\.rfa$/i.test(file)) return [file,null]; throw error; }
  }));
}
function refresh(force = false) {
  sync.lastChecked = new Date().toISOString();
  try {
    const next = fingerprint();
    if (!force && next === applied) { sync.state='watching'; sync.error=null; return; }
    if (!force && next !== candidate) { markPending(); candidate=next; candidateSince=Date.now(); sync.state='settling'; return; }
    if (!force && Date.now()-candidateSince < settleMs) return;
    sync.state='updating';
    const updated = buildCatalog({sources,output:dist,metadataRoot});
    if (fingerprint() !== next) { candidate=null; sync.state='settling'; return; }
    catalog=updated;
    families=new Map(catalog.items.map(item => [item.id,item]));
    applied=next; candidate=null; sync.state='watching'; sync.error=null; sync.pendingIds=[];
  } catch (error) {
    sync.state='error'; sync.error=error.message;
    console.error('Catalog sync:',error.message);
  }
}
refresh(true);
const monitor=setInterval(refresh,pollMs);
monitor.unref();
const mimeTypes = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8'};
const settings=createSettings({configPath,dist,metadataRoot,getSources:()=>sources,applySources:(next,updated)=>{
 sources=next;catalog=updated;families=new Map(updated.items.map(item=>[item.id,item]));applied=fingerprint();candidate=null;
 sync={state:'watching',lastChecked:new Date().toISOString(),error:null,pendingIds:[]};
}});
const server = http.createServer((request, response) => {
  const expectedHost='127.0.0.1:'+server.address().port;
  if(request.headers.host!==expectedHost){response.writeHead(403).end();return;}
  let route;
  try { route = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400).end(); return; }
  const json=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(request.method==='HEAD'?undefined:JSON.stringify(value));};
  if(route==='/api/settings'){
   if(['GET','HEAD'].includes(request.method)){json(200,settings.snapshot());return;}
   if(request.method!=='POST'){json(405,{error:'Method not allowed'});return;}
   if(request.headers.origin!=='http://'+expectedHost || request.headers['x-abby-config-token']!==settings.token || !/^application\/json(?:;|$)/i.test(request.headers['content-type']||'')){json(403,{error:'請從本機網頁重新開啟路徑設定。'});return;}
   const chunks=[];let size=0,ended=false;
   request.on('data',chunk=>{size+=chunk.length;if(size>65536){if(!ended){ended=true;json(413,{error:'設定內容過大。'});}return;}chunks.push(chunk);});
   request.on('end',()=>{if(ended)return;try{json(200,settings.save(JSON.parse(Buffer.concat(chunks).toString('utf8'))));}catch(error){json(400,{error:error.message});}});
   return;
  }
  if (!['GET','HEAD'].includes(request.method)) {response.writeHead(405).end();return;}
  if (route === '/api/health') {
    response.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify({application:'abby-door-library', programVersion,families:families.size,revision:publicCatalog().revision,sync}));
    return;
  }
  if (route === '/api/catalog' || route === '/catalog.json' || route === '/catalog.js') {
    const isScript=route === '/catalog.js';
    response.writeHead(200, {'Content-Type':isScript ? mimeTypes['.js'] : mimeTypes['.json'],'Cache-Control':'no-store'});
    const body=JSON.stringify(publicCatalog()).replaceAll('<','\\u003c');
    response.end(request.method === 'HEAD' ? undefined : isScript ? 'window.DOOR_CATALOG = '+body+';' : body);
    return;
  }
  let filename;
  const headers = {'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'};
  if (route.startsWith('/family/')) {
    const family = families.get(route.slice('/family/'.length));
    if (!family) { response.writeHead(404).end(); return; }
    filename = family.path;
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(family.filename);
  } else {
    filename = path.resolve(dist, '.' + (route === '/' ? '/index.html' : route));
    if (!filename.startsWith(dist + path.sep) || !['.html','.js','.css','.png','.json'].includes(path.extname(filename))) {
      response.writeHead(404).end(); return;
    }
    headers['Content-Type'] = mimeTypes[path.extname(filename)];
  }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404).end(); return; }
    headers['Content-Length'] = stat.size;
    response.writeHead(200, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = fs.createReadStream(filename);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  });
});
server.on('close',()=>clearInterval(monitor));
server.listen(port, '127.0.0.1', () => console.log('Door library ready at http://127.0.0.1:'+server.address().port));
server.on('error', error => { clearInterval(monitor); console.error(error.message); process.exitCode = 1; });
return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startLibrary();
