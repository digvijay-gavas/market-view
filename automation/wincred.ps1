$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.target -notmatch '^MarketView/Collector/[a-f0-9]{16}$') { throw 'Invalid target' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MarketViewCredential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct CREDENTIAL {
  public uint Flags, Type; public string TargetName, Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob;
  public uint Persist, AttributeCount; public IntPtr Attributes;
  public string TargetAlias, UserName;
 }
 [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Read(string target,uint type,uint flags,out IntPtr value);
 [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Write(ref CREDENTIAL value,uint flags);
 [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Delete(string target,uint type,uint flags);
 [DllImport("advapi32.dll")] static extern void CredFree(IntPtr value);
 public static string Get(string target) { IntPtr ptr; if(!Read(target,1,0,out ptr)){if(Marshal.GetLastWin32Error()==1168)return "";throw new Exception("Credential read failed");} try {var c=(CREDENTIAL)Marshal.PtrToStructure(ptr,typeof(CREDENTIAL));byte[] bytes=new byte[c.CredentialBlobSize];Marshal.Copy(c.CredentialBlob,bytes,0,bytes.Length);return Encoding.UTF8.GetString(bytes);}finally{CredFree(ptr);} }
 public static void Set(string target,string value) {byte[] bytes=Encoding.UTF8.GetBytes(value);if(bytes.Length>2048)throw new Exception("Credential too large");IntPtr ptr=Marshal.AllocHGlobal(bytes.Length);try{Marshal.Copy(bytes,0,ptr,bytes.Length);var c=new CREDENTIAL {Type=1,TargetName=target,CredentialBlobSize=(uint)bytes.Length,CredentialBlob=ptr,Persist=2,UserName="market-view-collector"};if(!Write(ref c,0))throw new Exception("Credential write failed");}finally{Marshal.FreeHGlobal(ptr);} }
 public static void Remove(string target){if(!Delete(target,1,0)&&Marshal.GetLastWin32Error()!=1168)throw new Exception("Credential removal failed");}
}
'@
switch ($request.operation) {
 'get' { [Console]::Out.Write([MarketViewCredential]::Get($request.target)) }
 'set' { [MarketViewCredential]::Set($request.target, $request.value) }
 'delete' { [MarketViewCredential]::Remove($request.target) }
 default { throw 'Invalid operation' }
}
