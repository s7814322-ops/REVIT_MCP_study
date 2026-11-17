import path from 'node:path';
export function isAuthorizedCopy(family,processingVersion,copy,root) {
  if(!copy || processingVersion!=='2024') return false;
  const location=path.resolve(root,copy);
  const oldDoor=['409c23bca0fe31c1','161556495257066b'].includes(family.id) && family.revitVersion==='2016' &&
    location.startsWith(path.join(root,'render/upgrade-copies/2024')+path.sep);
  const safety=family.sourceId==='safety' && family.revitVersion==='2018' &&
    location.startsWith(path.join(root,'render/upgrade-copies/safety-2024')+path.sep);
  const accessible=family.sourceId==='accessible-toilet' && family.revitVersion==='2018' &&
    location.startsWith(path.join(root,'render/upgrade-copies/accessible-2024')+path.sep);
  return oldDoor || safety || accessible;
}
