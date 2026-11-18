import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMaintenance} from './maintenance.mjs';
// Nightly updater invokes this only after the library service has stopped.
const root=path.dirname(fileURLToPath(import.meta.url));
if(process.argv[2]!=='cleanup-temp')throw Error('Only cleanup-temp is supported offline.');
const catalogFile=path.join(root,'dist/catalog.json'),configPath=path.join(root,'sources.local.json');
if(!fs.existsSync(catalogFile)||!fs.existsSync(configPath)){console.log('Library not configured; cleanup skipped.');}
else {
 const maintenance=createMaintenance({metadataRoot:root,configPath,getCatalog:()=>JSON.parse(fs.readFileSync(catalogFile,'utf8')),previewSync:null,refresh:()=>{}});
 try{console.log(JSON.stringify(await maintenance.run('cleanup-temp',{dryRun:!process.argv.includes('--apply')})));}
 catch(error){console.log(JSON.stringify({ok:false,skipped:true,reason:error.message}));}
}
