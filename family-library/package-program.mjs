import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
if(!process.argv[2])throw Error('Usage: node package-program.mjs <empty-output-folder>');
const output=path.resolve(process.argv[2]);
if(fs.existsSync(output)&&fs.readdirSync(output).length)throw Error('Program output folder must be empty.');
const names=['sources.mjs','source-files.mjs','cfb.mjs','version-policy.mjs','server.mjs','settings.mjs','preview-sync.mjs','build-catalog.mjs','portable-previews.mjs','import-previews.mjs','Start-Library.ps1','Start-Library.cmd',
 'dist/index.html','dist/app.js','dist/settings.js','dist/styles.css','dist/viewer3d.js','dist/vendor/three/three.module.js','dist/vendor/three/three.core.js','dist/vendor/three/OrbitControls.js','dist/vendor/three/LICENSE'];
const files=[];
for(const relative of names){const bytes=fs.readFileSync(path.join(root,relative));const target=path.join(output,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);files.push({path:relative,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
const revision=crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
fs.writeFileSync(path.join(output,'program-manifest.json'),JSON.stringify({schema:1,revision,files},null,2));
console.log(JSON.stringify({programFiles:files.length,revision}));
