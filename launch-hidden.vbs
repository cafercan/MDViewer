Option Explicit

Dim shell, fso, scriptDir, command, arg

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = """" & scriptDir & "\run.bat" & """"

For Each arg In WScript.Arguments
    command = command & " " & """" & Replace(arg, """", """""") & """"
Next

shell.Run command, 0, False
