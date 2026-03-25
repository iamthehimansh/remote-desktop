' Launch start-dashboard.bat as Administrator silently (no UAC popup if user is admin)
Set objShell = CreateObject("Shell.Application")
objShell.ShellExecute "cmd.exe", "/c ""H:\remote-desktop\scripts\start-dashboard.bat""", "", "runas", 0
