# Used by test\desktop.mjs: real mouse and keyboard input on the Focus window.
# Drags the top bar, resizes from the bottom-left corner, then minimizes it and presses
# Ctrl+Alt+N. Prints one line of JSON. Buttons and keys are always released, even on errors.
param([int]$ProcessId)
$ErrorActionPreference = 'Stop'
if (Test-Path 'D:\Work\Personal\tools') { $env:TEMP = 'D:\Work\Personal\tools\tmp'; $env:TMP = $env:TEMP }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class In {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
}
"@

$h = (Get-Process -Id $ProcessId).MainWindowHandle
function Get-Rect { $r = New-Object In+RECT; [In]::GetWindowRect($h, [ref]$r) | Out-Null; $r }
function Show-Rect($r) { "$($r.L),$($r.T),$($r.R - $r.L)x$($r.B - $r.T)" }
function Invoke-Drag([int]$x1, [int]$y1, [int]$x2, [int]$y2) {
  [In]::SetCursorPos($x1, $y1) | Out-Null
  Start-Sleep -Milliseconds 200
  [In]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero) # left button down
  try {
    for ($i = 1; $i -le 15; $i++) {
      [In]::SetCursorPos([int]($x1 + ($x2 - $x1) * $i / 15), [int]($y1 + ($y2 - $y1) * $i / 15)) | Out-Null
      Start-Sleep -Milliseconds 25
    }
    Start-Sleep -Milliseconds 150
  } finally {
    [In]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero) # left button up
  }
  Start-Sleep -Milliseconds 500
}

$scale = [In]::GetDpiForWindow($h) / 96
[In]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400

# 1. Drag by the empty middle of the top bar (5 px frame + 42 px bar).
$a = Get-Rect
$x = $a.L + [int](140 * $scale); $y = $a.T + [int](26 * $scale)
Invoke-Drag $x $y ($x - 160) ($y + 90)
$b = Get-Rect
$moved = ($b.L -ne $a.L) -and ($b.T -ne $a.T) -and (($b.R - $b.L) -eq ($a.R - $a.L))

# 2. Resize from the bottom-left corner.
Invoke-Drag ($b.L + 2) ($b.B - 3) ($b.L - 60) ($b.B + 50)
$c = Get-Rect
$resized = (($c.R - $c.L) -gt ($b.R - $b.L)) -and (($c.B - $c.T) -gt ($b.B - $b.T))

# 3. Minimize, then Ctrl+Alt+N brings it back.
[In]::ShowWindow($h, 6) | Out-Null # SW_MINIMIZE
Start-Sleep -Milliseconds 600
$minimized = [In]::IsIconic($h)
[In]::keybd_event(0x11, 0, 0, [IntPtr]::Zero) # Ctrl down
[In]::keybd_event(0x12, 0, 0, [IntPtr]::Zero) # Alt down
try {
  [In]::keybd_event(0x4E, 0, 0, [IntPtr]::Zero) # N
  Start-Sleep -Milliseconds 60
  [In]::keybd_event(0x4E, 0, 2, [IntPtr]::Zero)
} finally {
  [In]::keybd_event(0x12, 0, 2, [IntPtr]::Zero) # Alt up
  [In]::keybd_event(0x11, 0, 2, [IntPtr]::Zero) # Ctrl up
}
Start-Sleep -Milliseconds 1000
$summoned = -not [In]::IsIconic($h)

@{ moved = $moved; resized = $resized; minimized = $minimized; summoned = $summoned
   start = (Show-Rect $a); afterDrag = (Show-Rect $b); afterResize = (Show-Rect $c) } | ConvertTo-Json -Compress
