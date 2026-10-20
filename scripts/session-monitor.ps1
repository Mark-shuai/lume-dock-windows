param([int]$DockPid)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LumeForeground {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static string Probe(int ownPid) {
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) throw new Exception("Foreground unavailable");
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    if (pid == ownPid) return "{\"own\":true,\"fullscreen\":false}";
    var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
    string cls = name.ToString();
    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return "{\"own\":false,\"fullscreen\":false}";
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      RECT rect;
      var info = new MONITORINFO(); info.Size = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetWindowRect(hwnd, out rect) || !GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref info)) throw new Exception("Bounds unavailable");
      bool noCaption = (GetWindowLong(hwnd, -16) & 0x00C00000) == 0;
      bool primary = (info.Flags & 1) != 0;
      bool maximized = IsZoomed(hwnd);
      bool covers = rect.Left <= info.Monitor.Left + 2 && rect.Top <= info.Monitor.Top + 2 && rect.Right >= info.Monitor.Right - 2 && rect.Bottom >= info.Monitor.Bottom - 2;
      return "{\"own\":false,\"fullscreen\":" + ((primary && noCaption && !maximized && covers) ? "true" : "false") + "}";
    } finally { if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
  }
}
'@
while ($null -ne ($line = [Console]::ReadLine())) {
  if ($line -ne 'probe') { continue }
  try { [Console]::WriteLine([LumeForeground]::Probe($DockPid)); [Console]::Out.Flush() }
  catch { [Console]::Error.WriteLine('Foreground probe failed'); exit 1 }
}
