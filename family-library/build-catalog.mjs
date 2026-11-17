import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readCompound } from './cfb.mjs';
import {librarySources} from './sources.mjs';
import {listFamilyFiles} from './source-files.mjs';
import {isAuthorizedCopy} from './version-policy.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const sourceFolder = librarySources.find(source=>source.id==='doors')?.path;
export function buildCatalog({source, sources = source ? [{id:'doors',label:path.basename(source),path:source}] : librarySources,
  output = path.join(root, 'dist'), metadataRoot = root} = {}) {
const previousPath = path.join(output, 'catalog.json');
const previous = fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : {items:[]};
const previousItems = new Map(previous.items.map(item => [item.id,item]));
const overridesPath = path.join(metadataRoot, 'rendered-previews.json');
const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};
const modelsPath = path.join(metadataRoot, 'models-index.json');
const models = fs.existsSync(modelsPath) ? JSON.parse(fs.readFileSync(modelsPath, 'utf8')) : {};
const typeModelsPath=path.join(metadataRoot,'type-models-index.json');
const typeModels=fs.existsSync(typeModelsPath)?JSON.parse(fs.readFileSync(typeModelsPath,'utf8')):{};
fs.mkdirSync(path.join(output, 'previews'), { recursive: true });
const items = [];
for (const origin of sources) {
for (const {filename,fullPath,relative} of listFamilyFiles(origin)) {
  const stat = fs.statSync(fullPath);
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
  const id = crypto.createHash('sha256').update(origin.id === 'doors' ? relative : origin.id + '\0' + relative).digest('hex').slice(0, 16);
  const item = { id, sourceId:origin.id,sourceLabel:origin.label,webCategory:origin.category,relativePath:relative,sourceHash, filename, name: filename.slice(0, -4), bytes: stat.size,
    modified: stat.mtime.toISOString(), path: fullPath.replaceAll('/', '\\'),
    backup: /\.\d{4}\.rfa$/i.test(filename), preview: null, previewSource: null, atom: '', error: null };
  try {
    const streams = readCompound(fullPath,['PartAtom','RevitPreview4.0']);
    item.atom = streams.find(stream => stream.name === 'PartAtom')?.data.toString('utf8') || '';
    const preview = streams.find(stream => stream.name === 'RevitPreview4.0');
    if (preview) {
      const start = preview.data.indexOf(Buffer.from('89504e470d0a1a0a', 'hex'));
      if (start >= 0) {
        let end = start + 8;
        while (end + 12 <= preview.data.length) {
          const size = preview.data.readUInt32BE(end);
          const type = preview.data.toString('ascii', end + 4, end + 8);
          end += size + 12;
          if (type === 'IEND') {
            fs.writeFileSync(path.join(output, 'previews', id + '.png'), preview.data.subarray(start, end));
            item.preview = 'previews/' + id + '.png';
            item.previewSource = 'RFA 內建預覽';
            break;
          }
        }
      }
    }
  } catch (error) { throw new Error('元件尚未可讀取：' + filename + ' (' + error.message + ')'); }
  const after = fs.statSync(fullPath);
  if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs ||
      sourceHash !== crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex'))
    throw new Error('元件仍在寫入：' + filename);
  item.revitVersion = /<A:product-version>(\d+)<\/A:product-version>/.exec(item.atom)?.[1] || null;
  const override = overrides[id];
  if (override && (override.renderer === 'Revit ' + item.revitVersion ||
      isAuthorizedCopy(item,override.renderer.replace('Revit ',''),override.upgradedCopy,root)) && fs.existsSync(path.join(output, override.preview))) {
    if (sourceHash === override.sourceHash) {
      item.preview = override.preview;
      item.previewSource = override.renderer + ' 實際 3D 外觀' + (override.upgradedCopy?'（已授權升級副本）':'');
      item.previewWarning = override.warning || null;
    }
  }
  const model = models[id];
  const variants=typeModels[id];
  if(variants && variants.sourceHash===sourceHash &&
      (variants.processingVersion===item.revitVersion || isAuthorizedCopy(item,variants.processingVersion,variants.upgradedCopy,root)))
    item.typeModels=variants;
  if (model?.status === 'ready') {
    const allowed = model.processingVersion === item.revitVersion ||
      isAuthorizedCopy(item,model.processingVersion,model.upgradedCopy,root);
    if (sourceHash === model.sourceHash && allowed && fs.existsSync(path.join(output, model.url))) item.model = model;
  }
  if (model?.status === 'unavailable') item.modelStatus = '此元件的 3D 幾何未能匯出，可使用圖片預覽。';
  if (item.model && item.model.geometryPipeline !== 'revit-render-v2')
    item.modelReviewNote = item.revitVersion === '2023'
      ? 'Revit 2023 依你的設定暫停重匯。舊 3D 可能缺少幾何，預設顯示圖片。'
      : '舊 3D 可能缺少幾何，等待重新匯出，預設顯示圖片。';
  if (/<term>(?:門標籤|窗標籤|多重品類標籤)<\/term>/.test(item.atom)) {
    delete item.model;
    item.modelStatus = '此元件是 2D 標籤，使用原始圖片預覽。';
  }
  else if (item.revitVersion === '2023' && !item.model) {
    item.modelStatus = 'Revit 2023 依你的設定先跳過，保留圖片預覽。';
  }
  else if (!item.model && !item.typeModels && (!model || model.status === 'ready' ||
      previousItems.get(id)?.modelPending ||
      (previousItems.get(id)?.sourceHash && previousItems.get(id).sourceHash !== sourceHash))) {
    item.modelPending = true;
    item.modelStatus = '待重新匯出：請使用此元件對應的 Revit 版本產生 3D。';
  }
  if(item.sourceId==='safety' && item.revitVersion==='2018' && !item.typeModels &&
      !fs.existsSync('C:/Program Files/Autodesk/Revit 2018/Revit.exe')) {
    item.modelPending=true;
    item.modelRequirement='2024 升級副本';
    item.modelStatus='待重新匯出：已授權使用 2024 升級副本處理；原始 RFA 維持 2018。';
  }
  if (item.preview) {
    const imageHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(output,item.preview))).digest('hex');
    item.preview += '?v=' + sourceHash.slice(0,16) + '-' + imageHash.slice(0,16);
  }
  items.push(item);
}
}
const revision = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
const catalog = {generated:revision === previous.revision ? previous.generated : new Date().toISOString(),revision,
  source:sources.map(origin=>origin.path).join('\n'),sources,items};
for (const [name,value] of [['catalog.json',JSON.stringify(catalog)],['catalog.js','window.DOOR_CATALOG = ' + JSON.stringify(catalog).replaceAll('<', '\\u003c') + ';\n']]) {
  const target = path.join(output,name);
  fs.writeFileSync(target + '.tmp',value);
  fs.renameSync(target + '.tmp',target);
}
return catalog;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = buildCatalog();
  console.log(JSON.stringify({total:catalog.items.length,revision:catalog.revision}));
}
