using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Newtonsoft.Json;

namespace RevitMCP.FamilyLibrary {
 public static class LibraryDeployment {
  public class ProgramFile {public string path{get;set;} public string sha256{get;set;}}
  public class Manifest {public int schema{get;set;} public string revision{get;set;} public ProgramFile[] files{get;set;}}
  class InstalledState {public string Version{get;set;}}
  static string Hash(string file){using(var sha=SHA256.Create())using(var input=File.OpenRead(file))return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();}
  static bool Allowed(string file){
   string[] roots={"sources.mjs","source-files.mjs","cfb.mjs","version-policy.mjs","server.mjs","settings.mjs","build-catalog.mjs","portable-previews.mjs","import-previews.mjs","Start-Library.ps1","Start-Library.cmd"};
   string[] assets={"dist/index.html","dist/app.js","dist/settings.js","dist/styles.css","dist/viewer3d.js","dist/vendor/three/three.module.js","dist/vendor/three/three.core.js","dist/vendor/three/OrbitControls.js","dist/vendor/three/LICENSE"};
   return roots.Contains(file)||assets.Contains(file);
  }
  public static bool Install(string source,string destination){
   source=Path.GetFullPath(source);destination=Path.GetFullPath(destination);
   var manifest=JsonConvert.DeserializeObject<Manifest>(File.ReadAllText(Path.Combine(source,"program-manifest.json")));
   if(manifest==null || manifest.schema!=1 || !Regex.IsMatch(manifest.revision??"","^[a-f0-9]{64}$") || manifest.files==null || manifest.files.Length==0)throw new IOException("Invalid family library program manifest.");
   var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
   foreach(var file in manifest.files){
    if(file==null || !Allowed(file.path) || !seen.Add(file.path) || !Regex.IsMatch(file.sha256??"","^[a-f0-9]{64}$"))throw new IOException("Unsafe family library program entry.");
    if(Hash(Path.Combine(source,file.path))!=file.sha256)throw new IOException("Family library program hash mismatch.");
   }
   var marker=Path.Combine(destination,".program-version");
   if(File.Exists(marker)&&File.ReadAllText(marker).Trim()==manifest.revision && manifest.files.All(file=>File.Exists(Path.Combine(destination,file.path))&&Hash(Path.Combine(destination,file.path))==file.sha256))return false;
   Directory.CreateDirectory(destination);
   var backups=new Dictionary<string,byte[]>();var changed=new List<string>();
   try{
    foreach(var file in manifest.files){var target=Path.Combine(destination,file.path);backups[target]=File.Exists(target)?File.ReadAllBytes(target):null;Directory.CreateDirectory(Path.GetDirectoryName(target));changed.Add(target);File.Copy(Path.Combine(source,file.path),target,true);}
    File.WriteAllText(marker,manifest.revision);return true;
   }catch{
    foreach(var target in changed){if(backups[target]!=null)File.WriteAllBytes(target,backups[target]);else if(File.Exists(target))File.Delete(target);}throw;
   }
  }
  public static void InstallCurrent(string destination){
   var installRoot=Directory.GetParent(destination).FullName;
   var stateFile=Path.Combine(installRoot,"current.json");if(!File.Exists(stateFile))return;
   var state=JsonConvert.DeserializeObject<InstalledState>(File.ReadAllText(stateFile));
   if(state==null || !Regex.IsMatch(state.Version??"","^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$"))throw new IOException("Invalid Abby installation state.");
   var source=Path.Combine(installRoot,"releases",state.Version,"family-library");
   if(Directory.Exists(source))Install(source,destination);
  }
 }
}
