# Builds app\KangNotes.exe with the C# compiler that comes with Windows (.NET Framework 4.8),
# so no .NET SDK is needed. Run: npm run desktop   (or this script directly)
# -Out <folder> builds somewhere else, e.g. to check it compiles while the app is open.
param([string]$Out)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out = if ($Out) { $Out } else { Join-Path (Split-Path $here -Parent) 'app' }
$fx = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fx 'csc.exe'
$lib = Join-Path $here 'lib'
# On the PC this was built on, keep the compiler's temp files on D: (see tools\local-tools.mjs).
if (Test-Path 'D:\Work\Personal\tools') {
  New-Item -ItemType Directory -Force 'D:\Work\Personal\tools\tmp' | Out-Null
  $env:TEMP = 'D:\Work\Personal\tools\tmp'; $env:TMP = $env:TEMP
}

New-Item -ItemType Directory -Force $out | Out-Null
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
  "/out:$out\KangNotes.exe" "/win32icon:$here\app.ico" "/win32manifest:$here\app.manifest" `
  "/r:$lib\Microsoft.Web.WebView2.Core.dll" "/r:$lib\Microsoft.Web.WebView2.WinForms.dll" `
  "/r:$fx\System.Windows.Forms.dll" "/r:$fx\System.Drawing.dll" "/r:$fx\System.Web.Extensions.dll" "/r:$fx\System.Core.dll" `
  "$here\KangNotes.cs" 2>&1 | Where-Object { $_ -notmatch 'only supports language versions up to C# 5|For more information|https://go.microsoft.com/fwlink/\?LinkID=533240' }
if ($LASTEXITCODE -ne 0) { throw "KangNotes.exe failed to compile" }

Copy-Item (Join-Path $lib '*.dll') $out -Force
Copy-Item (Join-Path $here 'KangNotes.exe.config') $out -Force
Copy-Item (Join-Path $lib 'WebView2-LICENSE.txt') $out -Force
Get-ChildItem $out | Select-Object Name, @{ n = 'KB'; e = { [math]::Round($_.Length / 1KB) } } | Format-Table -AutoSize
