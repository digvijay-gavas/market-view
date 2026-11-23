Option Explicit
Dim shell, fso, scriptPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "automation\admin-launch.ps1")
shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -File """ & scriptPath & """", 0, False
