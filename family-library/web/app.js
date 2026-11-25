const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const child = (node, name) => Array.from(node?.children || []).find(element => element.localName === name);
const children = (node, name) => Array.from(node?.children || []).filter(element => element.localName === name);
const text = node => node?.textContent?.trim() || '';
let source = window.DOOR_CATALOG;
const sizeLabel = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : Math.round(bytes / 1024) + ' KB';
let favorites = new Set();
try { favorites = new Set(JSON.parse(localStorage.getItem('abby-door-favorites') || '[]')); } catch {}
let category = '全部元件';
let selected = null;
let returnFocus = null;
let toastTimer;
let viewerHandle = null;
let viewerRequest = 0;
let viewerModulePromise;
let selectedModel = null;
let revitHostVersion = null;
let revitPlacing = false;
function updateRevitAction() {
  const button=$('#revit-place'), status=$('#revit-status');
  button.hidden=!revitHostVersion;status.hidden=!revitHostVersion;
  if(!revitHostVersion || !selected) return;
  const newer=Number(selected.version)>Number(revitHostVersion);
  button.disabled=revitPlacing || newer || !selected.types.length;
  status.textContent=newer ? '此元件需要 Revit '+selected.version+' 或更新版本。' : revitPlacing ? '正在交由 Revit 載入，請完成目前指令。' : '載入目前 Revit 專案後點選放置位置；原始 RFA 保留，舊版元件僅在專案內升級。';
}
window.addEventListener('abby-revit-ready',event=>{revitHostVersion=event.detail.version;updateRevitAction();});
window.addEventListener('abby-revit-result',event=>{revitPlacing=false;updateRevitAction();$('#revit-status').textContent=event.detail;});
$('#revit-place').addEventListener('click',()=>{
  if(!selected || !revitHostVersion || revitPlacing) return;
  revitPlacing=true;updateRevitAction();
  window.chrome.webview.postMessage({action:'place',id:selected.id,typeName:selectedTypeName(),sourceHash:selected.sourceHash});
});

function selectedTypeName() { return selected?.types[Number($('#type-select').value)]?.name || '未命名類型'; }
function typeRecord() {
  const types=selected.typeModels?.types || [];
  return types.find(type=>type.name===selectedTypeName()) ||
    (selected.parseError && types.length===1 ? types[0] : null) ||
    (selected.types.length===1 && types.length===1 && types[0].name==='未命名類型' ? types[0] : null);
}
function resolveTypeModel() {
  if(selected.version==='2023') return null;
  const name=selectedTypeName();
  if(selected.typeModels) {
    const type=typeRecord();
    return type?.status==='ready' ? {...type,familyType:name,processingVersion:selected.typeModels.processingVersion} : null;
  }
  return selected.model?.familyType===name ? selected.model : null;
}
function typeStatus() {
  const record=typeRecord();
  if(record?.status==='unavailable') return '此類型無法產生 3D：'+record.reason;
  return selected.modelReviewNote || selected.modelStatus || '此類型的 3D 待重新匯出，不顯示其他類型的模型。';
}
function updateTypeDetails() {
  selectedModel=resolveTypeModel();
  const type=selected.types[Number($('#type-select').value)];
  const dimensions=(type?.parameters||[]).filter(p=>/^(寬度|宽度|寬|宽|高度|高|厚度|深度|Width|Height|Depth|Thickness)$/i.test(p.name));
  $('#type-size').textContent=dimensions.map(p=>p.name+' '+p.value+(p.units?' '+p.units:'')).join(' · ');
  $('#type-status').textContent=selectedModel ? '3D 對應類型「'+selectedTypeName()+'」 · Revit '+selectedModel.processingVersion : typeStatus();
  const warnings=[...new Set(selectedModel?.warnings || [])];
  if(warnings.length) $('#type-status').textContent+=' · Revit 回報 '+warnings.length+' 項訊息';
  $('#type-status').title=warnings.join('\n');
  if(selectedModel?.dimensions) $('#type-size').textContent += ($('#type-size').textContent?' ｜ ':'')+'模型外框 X/Y/Z：'+selectedModel.dimensions.map(v=>(v*1000).toFixed(0)).join(' × ')+' mm';
}
function changeType() {
  renderParameters(); updateTypeDetails();
  showPreview(Boolean(selected.typeModels || selected.model) && !selected.modelReviewNote && selected.revitCategory!=='輪廓');
}

function stopViewer() {
  viewerRequest++;
  viewerHandle?.dispose();
  viewerHandle = null;
}

async function showPreview(interactive) {
  stopViewer();
  const request = viewerRequest;
  const host = $('#large-preview');
  const is3D = interactive;
  host.classList.toggle('is-3d', Boolean(is3D));
  $('#mode-3d').setAttribute('aria-pressed', String(Boolean(is3D)));
  $('#mode-image').setAttribute('aria-pressed', String(!is3D));
  $('#viewer-actions').hidden = !is3D;
  $('#model-note').hidden = !is3D;
  if (!is3D) {
    host.innerHTML = preview(selected, true);
    $('#model-note').hidden=false;
    $('#model-note').textContent='此圖片為元件概覽，不隨族群類型切換。';
    return;
  }
  if (!selectedModel) {
    $('#viewer-actions').hidden=true;
    host.textContent=typeStatus();
    $('#model-note').textContent='目前選擇「'+selectedTypeName()+'」。';
    return;
  }
  $('#model-note').textContent = '拖曳旋轉 · 滾輪縮放 · 右鍵平移。3D 對應目前類型「' + selectedModel.familyType + '」。';
  if(selectedModel.dimensions) $('#model-note').textContent+=' 模型外框 X/Y/Z：'+selectedModel.dimensions.map(v=>(v*1000).toFixed(0)).join(' × ')+' mm。';
  if(selectedModel.previewContext==='opening-host-wall') $('#model-note').textContent+=' 此為純開口元件，含示範宿主牆以顯示實際開孔；外框尺寸包含牆體。';
  host.textContent = '正在啟動 3D 檢視器…';
  try {
    viewerModulePromise ||= import('./viewer3d.js');
    const module = await viewerModulePromise;
    if (request !== viewerRequest || $('#detail').hidden) return;
    viewerHandle = module.createFamilyViewer(host, selectedModel.url, () => toast('可切換圖片預覽查看此元件'));
  } catch (error) {
    if (request === viewerRequest) {
      host.textContent = '3D 檢視器未能啟動，請切換圖片預覽。';
      toast('3D 檢視器未能啟動');
    }
  }
}

function parameter(element, group) {
  const value = text(element);
  const unit = element.getAttribute('units') || '';
  return {
    name: element.getAttribute('displayName') || element.localName,
    kind: element.getAttribute('typeOfParameter') || '',
    storage: element.getAttribute('type') || '',
    units: unit && !value.toLowerCase().endsWith(unit.toLowerCase()) ? unit : '',
    value, group,
  };
}

function parseFamily(item) {
  const xml = new DOMParser().parseFromString(item.atom, 'application/xml');
  const root = xml.documentElement;
  const hasError = root.localName === 'parsererror' || xml.getElementsByTagName('parsererror').length > 0;
  if (hasError) return {...item, category:item.webCategory || (item.sourceId==='safety'?'職安衛元件':'資料待確認'), version:item.revitVersion || '未提供', revitCategory:'未提供', types:[], common:[], parseError:true, searchText:[item.name,item.sourceLabel,item.relativePath].filter(Boolean).join(' ').toLowerCase()};
  const cat = children(root, 'category').find(node => text(child(node, 'scheme')) === 'adsk:revit:grouping');
  const actualCategory = text(child(cat, 'term')) || '未分類';
  const family = child(root, 'family');
  const types = children(family, 'part').map(part => ({
    name: text(child(part, 'title')) || '未命名類型',
    parameters: Array.from(part.children).filter(element => element.localName !== 'title').map(element => parameter(element, '類型參數')),
  }));
  const common = [];
  for (const feature of children(child(root, 'features'), 'feature')) {
    for (const group of children(feature, 'group')) {
      const groupName = text(child(group, 'title')) || '族群屬性';
      for (const element of Array.from(group.children).filter(element => element.localName !== 'title')) {
        common.push(parameter(element, '族群屬性 · ' + groupName));
      }
    }
  }
  const design = children(root, 'link').map(link => child(link, 'design-file')).find(Boolean);
  const version = text(child(design, 'product-version')) || '未提供';
  const result = {...item, category:item.webCategory || (item.sourceId==='safety'?'職安衛元件':actualCategory),
    revitCategory:actualCategory,types, common, version, parseError:false};
  result.searchText = [item.name,item.sourceLabel,item.relativePath, actualCategory, ...types.map(type => type.name),
    ...types.flatMap(type => type.parameters.flatMap(parameter => [parameter.name, parameter.value])),
    ...common.flatMap(parameter => [parameter.name, parameter.value])].join(' ').toLowerCase();
  return result;
}

let items = source.items.map(parseFamily);
const missingIcon = '<svg viewBox="0 0 60 70" aria-hidden="true"><path d="M8 65V5h44v60M16 65V13h28v52M36 39h3M5 65h50"/></svg>';
function overviewModel(item) {
  if (item.version === '2023' || item.modelReviewNote) return null;
  return item.typeModels?.types.find(type => type.status === 'ready' && type.url)?.url || item.model?.url;
}
const snapshotCache = new Map();
let snapshotQueue = Promise.resolve();
async function snapshotFromGeometry(url) {
  if (snapshotCache.has(url)) return snapshotCache.get(url);
  const module = await (viewerModulePromise ||= import('./viewer3d.js'));
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-1200px;top:0;width:720px;height:440px;pointer-events:none';
  document.body.append(host);
  let handle;
  try {
    const png = await new Promise((resolve, reject) => {
      handle = module.createFamilyViewer(host, url, reject, resolve);
    });
    if (snapshotCache.size >= 32) snapshotCache.delete(snapshotCache.keys().next().value);
    snapshotCache.set(url, png);
    return png;
  } finally {
    handle?.dispose();
    host.remove();
  }
}
const visibleOverviews = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const target = entry.target;
    visibleOverviews.unobserve(target);
    snapshotQueue = snapshotQueue.then(async () => {
      if (!target.isConnected) return;
      try {
        const image = new Image();
        image.src = await snapshotFromGeometry(target.dataset.url);
        image.alt = target.dataset.label;
        target.replaceWith(image);
      } catch {
        target.textContent = '無法產生圖片預覽';
      }
    });
  }
});
customElements.define('abby-overview', class extends HTMLElement {
  connectedCallback() { visibleOverviews.observe(this); }
  disconnectedCallback() { visibleOverviews.unobserve(this); }
});

function preview(item, large = false) {
  if (item.preview) return '<img loading="' + (large ? 'eager' : 'lazy') + '" src="' + escapeHtml(item.preview) + '" alt="' + escapeHtml(item.name) + ' 的' + escapeHtml(item.previewSource || '外觀預覽') + '">';
  const url = overviewModel(item);
  if (url) return '<abby-overview class="missing" data-url="' + escapeHtml(url) + '" data-label="' + escapeHtml(item.name + ' 的模型靜態預覽') + '">正在產生圖片預覽…</abby-overview>';
  return '<div class="missing">' + missingIcon + '<span>檔案未內建預覽圖</span></div>';
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2400);
}

function saveFavorite(id) {
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  try { localStorage.setItem('abby-door-favorites', JSON.stringify([...favorites])); } catch { toast('瀏覽器未允許儲存收藏，這次瀏覽仍可使用。'); }
  render();
  if (selected) updateFavorite();
}

function updateFavorite() {
  const saved = favorites.has(selected.id);
  $('#favorite').textContent = saved ? '★' : '☆';
  $('#favorite').setAttribute('aria-label', saved ? '取消收藏元件' : '收藏元件');
  $('#favorite').setAttribute('aria-pressed', String(saved));
}

function render() {
  const query = $('#search').value.trim().toLowerCase();
  const result = items.filter(item =>
    (category === '全部元件' || item.category === category) &&
    (!$('#source-filter').value || item.sourceId === $('#source-filter').value) &&
    (!$('#version-filter').value || item.version === $('#version-filter').value) &&
    ($('#backups').checked || !item.backup) &&
    (!$('#preview-only').checked || item.preview || overviewModel(item)) &&
    (!$('#favorites-only').checked || favorites.has(item.id)) &&
    (!query || item.searchText.includes(query)));
  result.sort((a, b) => {
    switch ($('#sort').value) {
      case 'recent': return b.modified.localeCompare(a.modified);
      case 'types': return b.types.length - a.types.length || a.name.localeCompare(b.name, 'zh-Hant');
      case 'size': return b.bytes - a.bytes;
      default: return a.name.localeCompare(b.name, 'zh-Hant', {numeric:true});
    }
  });
  $('#result-count').textContent = '顯示 ' + result.length + ' / ' + items.length + ' 個元件';
  $('#empty').hidden = result.length > 0;
  $('#grid').innerHTML = result.map(item => '<article class="card"><button class="star ' + (favorites.has(item.id) ? 'saved' : '') + '" data-favorite="' + item.id + '" aria-label="' + escapeHtml((favorites.has(item.id) ? '取消收藏 ' : '收藏 ') + item.name) + '" aria-pressed="' + favorites.has(item.id) + '">' + (favorites.has(item.id) ? '★' : '☆') + '</button><button class="card-button" data-open="' + item.id + '"><div class="card-preview">' + preview(item) + '</div><div class="card-body"><div class="card-meta">' + escapeHtml(item.category) + '<span class="version-badge">Revit ' + escapeHtml(item.version) + '</span>' + (item.backup ? '<span class="backup">備份</span>' : '') + '</div><h3>' + escapeHtml(item.name) + '</h3><div class="card-bottom"><span>' + item.types.length + ' 個類型 · ' + sizeLabel(item.bytes) + '</span><b>查看元件 ↗</b></div></div></button></article>').join('');
  for (const item of result.filter(item => item.modelPending)) {
    const badge = document.createElement('span');
    badge.className = 'pending-badge'; badge.textContent = item.modelRequirement ? '待匯出 · 需 '+item.modelRequirement : '3D 待重新匯出';
    $('#grid').querySelector('[data-open="' + item.id + '"] .card-meta')?.append(badge);
  }
}

function renderParameters() {
  const type = selected.types[Number($('#type-select').value)];
  const parameters = [...(type?.parameters || []), ...selected.common];
  const query = $('#param-search').value.trim().toLowerCase();
  const filtered = parameters.filter(parameter => [parameter.name, parameter.value, parameter.kind, parameter.group].join(' ').toLowerCase().includes(query));
  $('#param-count').textContent = parameters.length;
  const groups = Map.groupBy ? Map.groupBy(filtered, parameter => parameter.group) : filtered.reduce((map, parameter) => {
    if (!map.has(parameter.group)) map.set(parameter.group, []);
    map.get(parameter.group).push(parameter);
    return map;
  }, new Map());
  $('#parameter-list').innerHTML = [...groups].map(([group, list]) => '<div class="param-group">' + escapeHtml(group) + ' · ' + list.length + '</div>' + list.map(parameter => '<div class="param-row"><div>' + escapeHtml(parameter.name) + '<small>' + escapeHtml(parameter.kind || '未提供資料型別') + (parameter.storage === 'shared' ? ' · 共用參數' : '') + '</small></div><div class="value">' + (parameter.value ? escapeHtml(parameter.value) : '<small>（空白值）</small>') + (parameter.units ? '<span class="unit">' + escapeHtml(parameter.units) + '</span>' : '') + '</div></div>').join('')).join('') || '<div class="no-params">' + (selected.parseError ? '此檔案的 PartAtom XML 無法解析。' : '沒有符合的參數。') + '</div>';
}

function switchTab(showParams) {
  $('#tab-preview').setAttribute('aria-selected', String(!showParams));
  $('#tab-params').setAttribute('aria-selected', String(showParams));
  $('#preview-panel').hidden = showParams;
  $('#params-panel').hidden = !showParams;
}

function openDetail(id) {
  selected = items.find(item => item.id === id);
  if (!selected) return;
  returnFocus = document.activeElement;
  $('#detail-title').textContent = selected.name;
  $('#detail-category').textContent = selected.category + ' / RFA FAMILY';
  $('#mode-3d').disabled = selected.version==='2023' || selected.revitCategory==='輪廓' || (!selected.model && !selected.typeModels);
  const provenance=selected.typeModels || selected.model;
  $('#preview-note').textContent = selected.modelReviewNote || (provenance
    ? '原始版本 Revit ' + selected.version + ' · 3D 處理版本 Revit ' + provenance.processingVersion + (provenance.upgradedCopy ? '（已授權的獨立升級副本）' : '')
    : selected.modelStatus || (selected.previewSource || 'RFA 內建預覽') + (selected.previewWarning ? '。' + selected.previewWarning : ''));
  const metadata = [
    ['來源資料夾', selected.sourceLabel || '門'],
    ['來源位置', selected.relativePath || selected.filename],
    ['元件類別', selected.category], ['Revit 儲存版本', selected.version],
    ['族群類型', selected.types.length + ' 個'], ['檔案大小', sizeLabel(selected.bytes)],
    ['檔案版本', selected.backup ? '備份版本' : '主要檔案'],
    ['最後修改', new Date(selected.modified).toLocaleDateString('zh-TW')],
  ];
  if(selected.webCategory || selected.sourceId==='safety') metadata.push(['Revit 原始類別',selected.revitCategory]);
  if (selected.typeModels || selected.model) metadata.push(['3D 處理版本', 'Revit ' + (selected.typeModels || selected.model).processingVersion]);
  $('#metadata').innerHTML = metadata.map(([label, value]) => '<div><span>' + label + '</span>' + escapeHtml(value) + '</div>').join('');
  $('#type-select').innerHTML = selected.types.map((type, index) => '<option value="' + index + '">' + escapeHtml(type.name) + '</option>').join('') || '<option>未儲存類型資料</option>';
  $('#type-select').disabled = !selected.types.length;
  if(!selected.typeModels && selected.model) {
    const defaultIndex=selected.types.findIndex(type=>type.name===selected.model.familyType);
    if(defaultIndex>=0) $('#type-select').value=defaultIndex;
  }
  $('#param-search').value = '';
  $('#download').href = location.protocol === 'file:' ? 'file:///' + selected.path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/') : '/family/' + selected.id;
  $('#download').download = selected.filename;
  updateRevitAction();
  updateFavorite();
  renderParameters();
  updateTypeDetails();
  switchTab(false);
  $('#overlay').hidden = false;
  $('#detail').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#detail').scrollTop = 0;
  showPreview(Boolean(selected.model || selected.typeModels) && !selected.modelReviewNote && selected.revitCategory!=='輪廓');
  $('#close').focus();
}

function closeDetail() {
  stopViewer();
  $('#detail').hidden = true;
  $('#overlay').hidden = true;
  document.body.style.overflow = '';
  returnFocus?.focus();
}

$('#grid').addEventListener('click', event => {
  const favorite = event.target.closest('[data-favorite]');
  if (favorite) return saveFavorite(favorite.dataset.favorite);
  const item = event.target.closest('[data-open]');
  if (item) openDetail(item.dataset.open);
});
$('#categories').addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  category = button.dataset.category;
  $('#categories').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
  render();
});
$('#close').addEventListener('click', closeDetail);
$('#overlay').addEventListener('click', closeDetail);
$('#favorite').addEventListener('click', () => saveFavorite(selected.id));
$('#tab-preview').addEventListener('click', () => switchTab(false));
$('#tab-params').addEventListener('click', () => switchTab(true));
$('#mode-3d').addEventListener('click', () => showPreview(true));
$('#mode-image').addEventListener('click', () => showPreview(false));
$('#viewer-reset').addEventListener('click', () => viewerHandle?.reset());
$('#viewer-front').addEventListener('click', () => viewerHandle?.front());
$('#viewer-in').addEventListener('click', () => viewerHandle?.zoomIn());
$('#viewer-out').addEventListener('click', () => viewerHandle?.zoomOut());
$('#type-select').addEventListener('change', changeType);
$('#param-search').addEventListener('input', renderParameters);
$('#search').addEventListener('input', render);
for (const selector of ['#backups','#preview-only','#favorites-only','#sort','#version-filter','#source-filter']) $(selector).addEventListener('change', render);
$('#reset').addEventListener('click', () => {
  $('#search').value = '';
  $('#backups').checked = true;
  $('#preview-only').checked = false;
  $('#favorites-only').checked = false;
  $('#version-filter').value = '';
  $('#source-filter').value = '';
  category = '全部元件';
  $('#categories').querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.category === category));
  render();
});
$('#copy-path').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(selected.path); toast('已複製 RFA 檔案路徑'); }
  catch { window.prompt('請複製此 RFA 檔案路徑', selected.path); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#detail').hidden) closeDetail();
  if (event.key === '/' && $('#detail').hidden && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault(); $('#search').focus();
  }
  if (event.key === 'Tab' && !$('#detail').hidden) {
    const focusable = [...$('#detail').querySelectorAll('button,input,select,a[href]')].filter(element => !element.disabled && element.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
    if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
  }
});

function applyCatalog(next, initial = false) {
  const opened = !$('#detail').hidden && selected;
  const oldItem = opened && source.items.find(item => item.id === selected.id);
  const selectedId = opened && selected.id;
  const typeName = opened && selected.types[Number($('#type-select').value)]?.name;
  const paramQuery = $('#param-search').value;
  const paramsOpen = !$('#params-panel').hidden;
  const preferredVersion = $('#version-filter').value;
  const preferredSource = $('#source-filter').value;
  source = next; window.DOOR_CATALOG = next;
  items = source.items.map(parseFamily);
  const categories = ['全部元件', ...new Set(items.map(item => item.category).sort((a,b) => a.localeCompare(b,'zh-Hant')))];
  if (!categories.includes(category)) category = '全部元件';
  $('#source-filter').innerHTML = '<option value="">所有來源資料夾</option>' + (source.sources || []).map(origin=>'<option value="'+escapeHtml(origin.id)+'">'+escapeHtml(origin.label)+'（'+items.filter(item=>item.sourceId===origin.id).length+'）</option>').join('');
  if ([...$('#source-filter').options].some(option=>option.value===preferredSource)) $('#source-filter').value=preferredSource;
  $('#version-filter').innerHTML = '<option value="">所有 Revit 版本</option>' + [...new Set(items.map(item => item.version))].sort().map(version => '<option value="' + escapeHtml(version) + '">Revit ' + escapeHtml(version) + '</option>').join('');
  if ([...$('#version-filter').options].some(option => option.value === preferredVersion)) $('#version-filter').value = preferredVersion;
  $('#categories').innerHTML = categories.map(name => '<button class="' + (name === category ? 'active' : '') + '" data-category="' + escapeHtml(name) + '">' + escapeHtml(name) + '<span>' + (name === '全部元件' ? items.length : items.filter(item => item.category === name).length) + '</span></button>').join('');
  $('#source').textContent = source.source.replaceAll('/', '\\');
  $('#generated').textContent = '資料更新 ' + new Date(source.generated).toLocaleString('zh-TW');
  $('#total').textContent = items.length;
  $('#all-count').textContent = items.length;
  render();
  if (selectedId) {
    const updated = source.items.find(item => item.id === selectedId);
    if (!updated) { closeDetail(); toast('此元件已從資料夾移除'); }
    else if (JSON.stringify(oldItem) !== JSON.stringify(updated)) {
      openDetail(selectedId);
      const typeIndex = selected.types.findIndex(type => type.name === typeName);
      if (typeIndex >= 0) $('#type-select').value = typeIndex;
      $('#param-search').value = paramQuery; changeType(); switchTab(paramsOpen);
    }
  }
  window.libraryDiagnostics = {total:items.length,previews:items.filter(item => item.preview || overviewModel(item)).length,types:items.reduce((sum,item) => sum+item.types.length,0),pending:items.filter(item => item.modelPending).length,revision:source.revision};
  if (!initial) toast('元件資料已自動更新');
}
applyCatalog(source, true);
let syncBusy = false;
async function checkSync() {
  if (syncBusy || location.protocol === 'file:') return;
  syncBusy = true;
  try {
    const response = await fetch('/api/health', {cache:'no-store'});
    if (!response.ok) throw new Error('offline');
    const health = await response.json();
    if (health.application !== 'abby-door-library' || !health.sync) throw new Error('server');
    if (health.revision !== source.revision) {
      const response = await fetch('/api/catalog', {cache:'no-store'});
      if (!response.ok) throw new Error('catalog');
      applyCatalog(await response.json());
    }
    $('#sync-status').textContent = health.sync.state === 'error' ? '同步暫停，等待檔案可讀取' : ['settling','updating','checking'].includes(health.sync.state) ? '偵測到變動，更新中…' : '自動同步已啟用';
    const previewSync=health.previewSync;
    if(previewSync?.state==='watching') $('#sync-status').textContent += ' · OneDrive 預覽同步中';
    else if(previewSync?.state==='waiting') $('#sync-status').textContent += ' · 等待預覽檔案同步完整';
    else if(previewSync?.state==='error') $('#sync-status').textContent += ' · 預覽同步暫停，將自動重試';
    $('#sync-status').title = health.sync.error || previewSync?.error || (previewSync?.folder ? '共用預覽：'+previewSync.folder : '資料夾變動後會自動更新；3D 需要另外匯出。');
  } catch { $('#sync-status').textContent = '連線中斷，正在重新連線…'; }
  finally { syncBusy = false; }
}
checkSync();
setInterval(checkSync, 3000);
window.addEventListener('focus', checkSync);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSync(); });

