import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const dist=path.join(root,'dist');fs.mkdirSync(dist,{recursive:true});
for(const name of ['app.js','index.html','styles.css','viewer3d.js','settings.js'])fs.copyFileSync(path.join(root,'web',name),path.join(dist,name));
const vendor=path.join(dist,'vendor/three');fs.mkdirSync(vendor,{recursive:true});
for(const [from,to] of [['build/three.module.js','three.module.js'],['build/three.core.js','three.core.js'],['examples/jsm/controls/OrbitControls.js','OrbitControls.js'],['LICENSE','LICENSE']])fs.copyFileSync(path.join(root,'node_modules/three',from),path.join(vendor,to));
console.log('Web assets prepared.');
