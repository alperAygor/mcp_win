' Starts the ArchMCP control panel without a console window. Used by the Start menu / desktop shortcut.
Set fso = CreateObject("Scripting.FileSystemObject")
guiDir = fso.GetParentFolderName(WScript.ScriptFullName)          ' ...\app\gui
appDir = fso.GetParentFolderName(fso.GetParentFolderName(guiDir)) ' install folder
node = appDir & "\runtime\node\node.exe"
Set sh = CreateObject("WScript.Shell")
sh.Run """" & node & """ """ & guiDir & "\launcher.mjs"" --app-dir """ & appDir & """", 0, False
