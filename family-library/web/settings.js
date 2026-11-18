(()=>{
 const el=id=>document.getElementById(id);
 const dialog=el('path-settings'),status=el('settings-status'),save=el('save-settings');
 let snapshot=null,saving=false;
 function close(){if(!saving){dialog.close();el('open-settings').focus();}}
 function lock(value){saving=value;save.disabled=value;el('settings-root').disabled=value;el('close-settings').disabled=value;el('cancel-settings').disabled=value;}
 el('open-settings').addEventListener('click',async()=>{
  snapshot=null;save.disabled=true;status.textContent='讀取目前設定…';dialog.showModal();
  try{
   const response=await fetch('/api/settings',{cache:'no-store'});if(!response.ok)throw Error('無法讀取設定，請確認本機服務已啟動。');
   snapshot=await response.json();el('settings-root').value=snapshot.config.familyRoot;el('settings-root').readOnly=Boolean(snapshot.environmentRoot);
   el('settings-environment').hidden=!snapshot.environmentRoot;el('settings-environment').textContent='根目錄由 ABBY_FAMILY_ROOT 環境變數指定。';
   save.disabled=false;status.textContent=snapshot.error || '這台電腦只需設定這一個路徑。';el('settings-root').focus();
  }catch(error){status.textContent=error.message;}
 });
 el('close-settings').addEventListener('click',close);el('cancel-settings').addEventListener('click',close);
 for(const action of ['rebuild-cache','cleanup-temp'])el(action).addEventListener('click',async()=>{
  if(!snapshot||saving)return;
  const message=el('maintenance-status');lock(true);for(const id of ['rebuild-cache','cleanup-temp'])el(id).disabled=true;
  message.textContent=action==='rebuild-cache'?'正在驗證共用預覽並重建快取…':'正在檢查可清理的暫存副本…';
  try{
   const response=await fetch('/api/maintenance',{method:'POST',headers:{'Content-Type':'application/json','X-Abby-Config-Token':snapshot.token},body:JSON.stringify({action,dryRun:false})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'維護失敗');
   await checkSync();message.textContent=result.deferred?'Revit 執行中，暫存副本已保留。':action==='rebuild-cache'?(result.status?.waiting?'可取得的預覽已修復，另有 '+result.status.waiting+' 項待同步或需確認；原快取保留。':'預覽快取已重建。'):'已清理 '+result.copies+' 組暫存副本，釋放 '+(result.bytes/1048576).toFixed(1)+' MB。';
  }catch(error){message.textContent='未完成：'+error.message;}
  finally{lock(false);for(const id of ['rebuild-cache','cleanup-temp'])el(id).disabled=false;}
 });
 dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
 el('settings-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!snapshot || saving)return;
  lock(true);status.textContent='正在重新讀取元件…';
  try{
   const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Abby-Config-Token':snapshot.token},body:JSON.stringify({familyRoot:el('settings-root').value.trim()})});
   const result=await response.json();if(!response.ok)throw Error(result.error || '設定無法儲存。');
   await checkSync();status.textContent='已儲存並套用，共 '+result.total+' 個元件。';
  }catch(error){status.textContent='未套用變更：'+error.message;}
  finally{lock(false);}
 });
})();
