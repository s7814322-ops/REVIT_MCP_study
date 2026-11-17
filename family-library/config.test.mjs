import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
process.env.ABBY_FAMILY_ROOT=path.join(os.tmpdir(),'family-library-tests');
const {resolveSources}=await import('./sources.mjs');
const {isAuthorizedCopy}=await import('./version-policy.mjs');
test('root changes on each computer while source identities stay stable',()=>{
 const first=resolveSources({familyRoot:path.resolve('machine-a')},{});
 const second=resolveSources({familyRoot:path.resolve('machine-b')},{});
 assert.deepEqual(first.map(x=>x.id),second.map(x=>x.id));
 for(let i=0;i<first.length;i++){assert.notEqual(first[i].path,second[i].path);assert.equal(first[i].relativePath,second[i].relativePath);}
});
test('one root applies to all categories and honors environment root',()=>{const base=path.resolve('environment-root');const sources=resolveSources({familyRoot:path.resolve('ignored')},{ABBY_FAMILY_ROOT:base});assert.equal(sources.length,4);for(const source of sources)assert.ok(source.path.startsWith(base+path.sep));assert.throws(()=>resolveSources({familyRoot:'relative'},{}));});
test('portable upgraded-copy provenance remains scoped after root change',()=>{
 const root=path.resolve('other-computer');
 const family={id:'test',sourceId:'safety',revitVersion:'2018'};
 assert.equal(isAuthorizedCopy(family,'2024','render/upgrade-copies/safety-2024/test.rfa',root),true);
 assert.equal(isAuthorizedCopy(family,'2024','../outside/test.rfa',root),false);
 assert.equal(isAuthorizedCopy({...family,sourceId:'doors'},'2024','render/upgrade-copies/safety-2024/test.rfa',root),false);
});

