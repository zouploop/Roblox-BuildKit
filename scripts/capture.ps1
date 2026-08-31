param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$ProcName = "RobloxStudioBeta",
  [int]$VpW = 0,   # plugin-reported 3D viewport width  (logical px); 0 = whole window
  [int]$VpH = 0,   # plugin-reported 3D viewport height (logical px)
  [string]$Place = ""  # active place filter (rbx_use_place): prefer the Studio window whose title matches
)
$ErrorActionPreference = "Stop"

# NOTE: this OS window-grab is the FALLBACK capture path. It needs Studio to be the
# visible foreground window (CopyFromScreen reads real screen pixels; PrintWindow can't
# read Studio's hardware-accelerated 3D viewport — it comes back black). The PRIMARY,
# reliable path is the official mcp__Roblox_Studio__screen_capture (Studio's own
# renderer; works even when Studio is backgrounded/minimized) fed coords from rbx_frame.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumDelegate cb, IntPtr l);
  public delegate bool EnumDelegate(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

# Find the Studio window by PID (Process.MainWindowHandle is often 0 for Studio).
$procs = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { throw "Roblox Studio process '$ProcName' not found. Is Studio open?" }
# With multiple Studios open, prefer the one whose window title contains the active
# place filter (the bridge routes commands to that same Studio). Fall back to the first.
$proc = $null
if ($Place -ne "") {
  $proc = $procs | Where-Object { $_.MainWindowTitle -like "*$Place*" } | Select-Object -First 1
}
if (-not $proc) { $proc = $procs | Select-Object -First 1 }
$script:spid = [uint32]$proc.Id
$script:best = [IntPtr]::Zero
$script:bestScore = -1
$cb = [WinCap+EnumDelegate] {
  param($hwnd, $l)
  $wpid = [uint32]0
  [WinCap]::GetWindowThreadProcessId($hwnd, [ref]$wpid) | Out-Null
  if ($wpid -ne $script:spid) { return $true }
  $r = New-Object WinCap+RECT
  [WinCap]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $score = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)
  if ([WinCap]::IsWindowVisible($hwnd)) { $score += 100000000 }
  if ([WinCap]::IsIconic($hwnd)) { $score -= 50000000 }
  if ($score -gt $script:bestScore) { $script:bestScore = $score; $script:best = $hwnd }
  return $true
}
[WinCap]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$h = $script:best
if ($h -eq [IntPtr]::Zero) { throw "no top-level window for Studio pid $($proc.Id)" }

if ([WinCap]::IsIconic($h)) { [WinCap]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 350 } # SW_RESTORE
# Best-effort bring to foreground (AttachThreadInput lifts the background-process block).
$fg = [WinCap]::GetForegroundWindow()
$fgThread = 0
[WinCap]::GetWindowThreadProcessId($fg, [ref]([uint32]$fgThread)) | Out-Null
$myThread = [WinCap]::GetCurrentThreadId()
$attached = $false
if ($fg -ne $h) { $attached = [WinCap]::AttachThreadInput($myThread, [uint32]$fgThread, $true) }
[WinCap]::BringWindowToTop($h) | Out-Null
[WinCap]::SetForegroundWindow($h) | Out-Null
if ($attached) { [WinCap]::AttachThreadInput($myThread, [uint32]$fgThread, $false) | Out-Null }
Start-Sleep -Milliseconds 350

# Client rect (excludes title bar + borders) in screen coordinates.
$cr = New-Object WinCap+RECT
[WinCap]::GetClientRect($h, [ref]$cr) | Out-Null
$origin = New-Object WinCap+POINT; $origin.X = 0; $origin.Y = 0
[WinCap]::ClientToScreen($h, [ref]$origin) | Out-Null
$cx = $origin.X; $cy = $origin.Y
$cw = $cr.Right - $cr.Left
$chgt = $cr.Bottom - $cr.Top
if ($cw -le 0 -or $chgt -le 0) { throw "bad client rect ${cw}x${chgt}" }

$capX = $cx; $capY = $cy; $capW = $cw; $capH = $chgt

# Crop to just the 3D viewport (drop ribbon + side/bottom docks) if the plugin gave its size.
# ViewportSize is the render area's pixel size, but Windows may expose the Studio
# client in logical or physical pixels. Try the exact dimensions first, then the
# DPI-scaled equivalent. If neither rectangle fits, the initialized whole-window
# rectangle remains the deliberate backup instead of returning a partial image.
if ($VpW -gt 0 -and $VpH -gt 0) {
  Add-Type -AssemblyName System.Drawing
  $gfx = [System.Drawing.Graphics]::FromHwnd($h)
  $scale = $gfx.DpiX / 96.0
  $gfx.Dispose()
  if ($scale -le 0) { $scale = 1.0 }
  $ribbonPx = [int]([math]::Round(135 * $scale))
  $candidates = @(
    @([int]$VpW, [int]$VpH, 135),
    @([int]([math]::Round($VpW * $scale)), [int]([math]::Round($VpH * $scale)), $ribbonPx)
  )
  foreach ($candidate in $candidates) {
    $vpwPx = $candidate[0]; $vphPx = $candidate[1]; $topPx = $candidate[2]
    if ($vpwPx -gt 16 -and $vphPx -gt 16 -and $vpwPx -le $cw -and $topPx -ge 0 -and ($topPx + $vphPx) -le $chgt) {
      $capX = $cx
      $capY = $cy + $topPx
      $capW = $vpwPx
      $capH = $vphPx
      break
    }
  }
}

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $capW, $capH
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($capX, $capY, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "OK ${capW}x${capH}"
