using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
using System.Net;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Xml.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;

namespace RevitMCP.FamilyLibrary {
 public static class Data {
  public static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AbbyMCP","door-library");
  public static T Read<T>(string text) {
   return JsonConvert.DeserializeObject<T>(text);
  }
  public static string Write(object value) {
   return JsonConvert.SerializeObject(value);
  }
  public static bool Local(string url) { Uri u;return Uri.TryCreate(url,UriKind.Absolute,out u)&&u.Scheme=="http"&&u.Host=="127.0.0.1"&&u.Port==4318; }
 }
 public class Item {public string id{get;set;} public string path{get;set;} public string sourceHash{get;set;} public string revitVersion{get;set;} public string atom{get;set;} }
 public class Catalog {public Item[] items{get;set;} }
 public class Request {public string action{get;set;} public string id{get;set;} public string typeName{get;set;} public string sourceHash{get;set;} }
 public static class LibraryRibbon {
  public static void Initialize(RibbonPanel panel) {
   panel.AddItem(new PushButtonData("AbbyFamilyLibrary","元件圖書館",typeof(LibraryRibbon).Assembly.Location,typeof(OpenLibrary).FullName){ToolTip="搜尋並直接載入元件至目前專案；原始 RFA 不修改。"});
  }
  public static void Shutdown(){if(OpenLibrary.Window!=null)OpenLibrary.Window.Close();}
 }
 [Autodesk.Revit.Attributes.Transaction(Autodesk.Revit.Attributes.TransactionMode.Manual)]
 public class OpenLibrary : IExternalCommand {
  public static LibraryWindow Window;
  public Result Execute(ExternalCommandData data,ref string message,ElementSet elements) {
   try {
    if(int.Parse(data.Application.Application.VersionNumber)<2024){TaskDialog.Show("ABBY 元件庫","元件庫整合目前支援 Revit 2024 或更新版本。");return Result.Cancelled;}
    if(Window==null){var handler=new PlaceHandler();var external=ExternalEvent.Create(handler);Window=new LibraryWindow(handler,external,data.Application.Application.VersionNumber);new WindowInteropHelper(Window).Owner=data.Application.MainWindowHandle;Window.Closed+=(s,e)=>{external.Dispose();Window=null;};}
    Window.Show();Window.Activate();return Result.Succeeded;
   }catch(Exception e){message=e.Message;return Result.Failed;}
  }
 }
 public class LibraryWindow : Window {
  readonly WebView2 web=new WebView2();readonly TextBlock status=new TextBlock{Margin=new Thickness(10),Text="正在連接本機元件庫…",TextWrapping=TextWrapping.Wrap};
  readonly PlaceHandler handler;readonly ExternalEvent external;readonly string version;
  public LibraryWindow(PlaceHandler h,ExternalEvent e,string v){
   handler=h;external=e;version=v;h.Window=this;Title="ABBY 元件圖書館 · Revit "+v;Width=1140;Height=820;MinWidth=650;MinHeight=500;
   var dock=new DockPanel();DockPanel.SetDock(status,Dock.Bottom);dock.Children.Add(status);dock.Children.Add(web);Content=dock;Loaded+=Initialize;
  }
  async void Initialize(object sender,RoutedEventArgs args){
   Loaded-=Initialize;
   try{
    // The launcher only starts the loopback service; no separate browser or download.
    Process.Start(new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(Data.Root,"Start-Library.ps1")+"\" -NoBrowser"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
    var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Data.Root,"revit","webview-profile-"+version));
    await web.EnsureCoreWebView2Async(env);
    web.CoreWebView2.Settings.AreHostObjectsAllowed=false;
    web.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;};
    web.CoreWebView2.NavigationStarting+=(s,e)=>{if(!Data.Local(e.Uri))e.Cancel=true;};
    web.CoreWebView2.PermissionRequested+=(s,e)=>{e.State=CoreWebView2PermissionState.Deny;};
    web.CoreWebView2.WebMessageReceived+=(s,e)=>{
     try{if(!Data.Local(e.Source))return;var r=Data.Read<Request>(e.WebMessageAsJson);if(r.action!="place")return;if(handler.Pending!=null){Notify("請先完成目前放置操作。");return;}handler.Pending=r;
      var result=external.Raise();if(result!=ExternalEventRequest.Accepted){handler.Pending=null;Notify("Revit 正忙碌，請結束目前指令後再試。");}else status.Text="等待 Revit 載入元件…";
     }catch(Exception ex){Notify(ex.Message);}
    };
    web.CoreWebView2.NavigationCompleted+=async(s,e)=>{if(e.IsSuccess){await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('abby-revit-ready',{detail:{version:"+Data.Write(version)+"}}));");status.Text="選擇元件與類型後按「載入並放置」。舊版元件僅在專案內升級，原始檔案保留。";}else status.Text="本機網頁尚未啟動，請按 Ctrl+R 重試。";};
    bool ready=await Task.Run(()=>{for(int attempt=0;attempt<20;attempt++){try{var req=WebRequest.Create("http://127.0.0.1:4318/api/health");req.Timeout=1000;using(var res=req.GetResponse())using(var reader=new StreamReader(res.GetResponseStream()))if(reader.ReadToEnd().Contains("abby-door-library"))return true;}catch{}System.Threading.Thread.Sleep(500);}return false;});
    if(!ready)throw new Exception("本機元件庫服務無法啟動，請檢查 server-error.log。");
    web.Source=new Uri("http://127.0.0.1:4318/");
   }catch(Exception ex){status.Text="啟動失敗："+ex.Message;}
  }
  public async void Notify(string text){status.Text=text;if(web.CoreWebView2!=null)try{await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('abby-revit-result',{detail:"+Data.Write(text)+"}));");}catch{} }
 }
 public class KeepExisting : IFamilyLoadOptions {
  public bool OnFamilyFound(bool inUse,out bool overwrite){overwrite=false;return true;}
  public bool OnSharedFamilyFound(Family family,bool inUse,out FamilySource source,out bool overwrite){source=FamilySource.Project;overwrite=false;return true;}
 }
 public class PlaceHandler : IExternalEventHandler {
  public Request Pending;public LibraryWindow Window;
  public string GetName(){return "ABBY 元件載入與放置";}
  public void Execute(UIApplication app){
   var request=Pending;if(request==null)return;string cache=null;
   try{
    var ui=app.ActiveUIDocument;if(ui==null||ui.Document.IsFamilyDocument)throw new Exception("請先開啟要放置元件的 Revit 專案。");
    var doc=ui.Document;if(doc.IsReadOnly||doc.IsModifiable)throw new Exception("請先完成目前編輯指令，再載入元件。");
    var catalog=Data.Read<Catalog>(File.ReadAllText(Path.Combine(Data.Root,"dist","catalog.json")));
    var item=catalog.items.SingleOrDefault(i=>i.id==request.id);if(item==null)throw new Exception("元件已移除，請重新整理清單。");
    if(item.sourceHash!=request.sourceHash)throw new Exception("來源元件已變更，請重新選取。");
    int year;if(!int.TryParse(item.revitVersion,out year)||year>int.Parse(app.Application.VersionNumber))throw new Exception("此元件需要 Revit "+item.revitVersion+" 或更新版本。");
    var xml=XDocument.Parse(item.atom);var family=xml.Root.Elements().First(x=>x.Name.LocalName=="family");
    var names=family.Elements().Where(x=>x.Name.LocalName=="part").Select(x=>x.Elements().First(n=>n.Name.LocalName=="title").Value.Trim()).ToArray();
    var typeName=request.typeName;
    if(!names.Contains(typeName)&&!(names.Length==1&&string.IsNullOrWhiteSpace(names[0])&&typeName=="未命名類型"))throw new Exception("指定類型已變更，請重新選取。");
    cache=Path.Combine(Data.Root,"revit","load-cache",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(cache);var copy=Path.Combine(cache,Path.GetFileName(item.path));
    File.Copy(item.path,copy);string hash;using(var sha=SHA256.Create())using(var input=File.OpenRead(copy))hash=BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();
    if(hash!=item.sourceHash)throw new Exception("來源檔案已更新，請等待網頁同步後再試。");
    using(var info=BasicFileInfo.Extract(copy))if(info.Format!=item.revitVersion)throw new Exception("元件實際版本與清單不同，已停止載入。");
    var familyName=xml.Root.Elements().First(x=>x.Name.LocalName=="title").Value.Trim();
    FamilySymbol symbol=new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().FirstOrDefault(s=>s.Family.Name==familyName&&s.Name==typeName);
    if(symbol!=null){var dialog=new TaskDialog("ABBY 元件庫"){MainInstruction="專案已有同名族群與類型",MainContent="將使用專案現有的「"+familyName+" : "+typeName+"」，不覆寫其參數或外觀。",CommonButtons=TaskDialogCommonButtons.Ok|TaskDialogCommonButtons.Cancel};if(dialog.Show()!=TaskDialogResult.Ok)return;}
    using(var tx=new Transaction(doc,"ABBY 載入元件："+Path.GetFileNameWithoutExtension(item.path))){
     tx.Start();if(symbol==null){
      if(names.Length==1&&string.IsNullOrWhiteSpace(names[0])){Family loaded;if(!doc.LoadFamily(copy,new KeepExisting(),out loaded)||loaded==null)throw new Exception("無法載入族群。");symbol=loaded.GetFamilySymbolIds().Select(id=>doc.GetElement(id)).OfType<FamilySymbol>().Single();}
      else if(!doc.LoadFamilySymbol(copy,typeName,new KeepExisting(),out symbol)||symbol==null)throw new Exception("無法載入指定類型；專案可能已有同名族群或目前不支援此元件。");
     }
     if(!symbol.IsActive)symbol.Activate();doc.Regenerate();if(tx.Commit()!=TransactionStatus.Committed)throw new Exception("元件載入交易未完成。");
    }
    Window.Notify("已載入「"+typeName+"」到「"+doc.Title+"」。請點選位置或宿主，Esc 結束。");Window.Hide();
    try{ui.PromptForFamilyInstancePlacement(symbol);}catch(Autodesk.Revit.Exceptions.OperationCanceledException){}
    Window.Notify("放置指令已結束。可繼續選取其他元件；原始 RFA 未修改。");
   }catch(Exception ex){Window.Notify(ex.Message);TaskDialog.Show("ABBY 元件庫",ex.Message);}
   finally{Pending=null;if(cache!=null)try{Directory.Delete(cache,true);}catch{}if(Window.IsLoaded){Window.Show();Window.Activate();}}
  }
 }
}
