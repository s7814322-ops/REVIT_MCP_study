import fs from 'node:fs';
import path from 'node:path';

// Include nested folders only for sources configured to do so. Ignore links.
export function listFamilyFiles(origin) {
  const files=[];
  function visit(directory) {
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const fullPath=path.join(directory,entry.name);
      if(entry.isDirectory() && origin.recursive) visit(fullPath);
      else if(entry.isFile() && /\.rfa$/i.test(entry.name))
        files.push({filename:entry.name,fullPath,relative:path.relative(origin.path,fullPath).replaceAll('\\','/')});
    }
  }
  visit(origin.path);
  return files.sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
}
