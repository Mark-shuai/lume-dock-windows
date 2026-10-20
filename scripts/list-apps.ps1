$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
# The Windows Shell supplies the real icon for classic and packaged apps.
# A missing icon never prevents an application from being listed.
$iconSource = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
public static class LumeShellIcon {
    [StructLayout(LayoutKind.Sequential)] public struct Size { public int cx; public int cy; }
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory {
        [PreserveSig] int GetImage(Size size, int flags, out IntPtr bitmap);
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string name, IntPtr context, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
    [StructLayout(LayoutKind.Sequential)] struct NativeBitmap {
        public int type, width, height, widthBytes;
        public ushort planes, bitsPixel;
        public IntPtr bits;
    }
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfo {
        public uint size; public int width, height;
        public ushort planes, bits; public uint compression, sizeImage;
        public int xppm, yppm; public uint colorsUsed, colorsImportant;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct FileInfo {
        public IntPtr icon; public int index; public uint attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string displayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string typeName;
    }
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr handle);
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr obj, int size, out NativeBitmap bitmap);
    [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint lines, [Out] byte[] bits, ref BitmapInfo info, uint usage);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHParseDisplayName(string name, IntPtr context, out IntPtr pidl, uint mask, out uint attributes);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SHGetFileInfo(IntPtr pidl, uint attributes, ref FileInfo info, uint size, uint flags);
    static string Encode(Image image) {
        using (var stream = new MemoryStream()) {
            image.Save(stream, ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
        }
    }
    // Shell HBITMAP pixels are premultiplied BGRA. FromHbitmap discards alpha.
    // Convert channels explicitly; never treat black RGB as a transparency key.
    public static bool StraightAlpha(byte[] pixels) {
        bool hasAlpha = false;
        for (int i = 0; i < pixels.Length; i += 4) {
            int a = pixels[i + 3];
            if (a == 0) { pixels[i] = pixels[i + 1] = pixels[i + 2] = 0; continue; }
            hasAlpha = true;
            for (int c = 0; c < 3; c++) pixels[i + c] = (byte)Math.Min(255, (pixels[i + c] * 255 + a / 2) / a);
        }
        return hasAlpha;
    }
    public static string EncodeBitmap(IntPtr handle) {
        NativeBitmap native;
        if (GetObject(handle, Marshal.SizeOf(typeof(NativeBitmap)), out native) == 0 || native.width <= 0 || native.height <= 0 || native.width > 256 || native.height > 256) return null;
        var info = new BitmapInfo { size = 40, width = native.width, height = -native.height, planes = 1, bits = 32 };
        byte[] pixels = new byte[native.width * native.height * 4];
        IntPtr dc = GetDC(IntPtr.Zero);
        if (dc == IntPtr.Zero) return null;
        try { if (GetDIBits(dc, handle, 0, (uint)native.height, pixels, ref info, 0) != native.height) return null; }
        finally { ReleaseDC(IntPtr.Zero, dc); }
        if (!StraightAlpha(pixels)) return null; // Legacy icons need their AND mask.
        using (var image = new Bitmap(native.width, native.height, PixelFormat.Format32bppArgb)) {
            var data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            try {
                for (int y = 0; y < native.height; y++) Marshal.Copy(pixels, y * native.width * 4, IntPtr.Add(data.Scan0, y * data.Stride), native.width * 4);
            } finally { image.UnlockBits(data); }
            return Encode(image);
        }
    }
    static string ReadLegacy(string parsingName) {
        IntPtr pidl = IntPtr.Zero;
        var info = new FileInfo();
        try {
            uint attributes;
            if (SHParseDisplayName(parsingName, IntPtr.Zero, out pidl, 0, out attributes) != 0) return null;
            // SHGFI_PIDL | SHGFI_ICON; Icon.ToBitmap retains the legacy AND mask.
            if (SHGetFileInfo(pidl, 0, ref info, (uint)Marshal.SizeOf(typeof(FileInfo)), 0x108) == IntPtr.Zero || info.icon == IntPtr.Zero) return null;
            using (var icon = Icon.FromHandle(info.icon))
            using (var image = icon.ToBitmap()) return Encode(image);
        } finally {
            if (info.icon != IntPtr.Zero) DestroyIcon(info.icon);
            if (pidl != IntPtr.Zero) Marshal.FreeCoTaskMem(pidl);
        }
    }
    public static string Read(string appId) {
        IntPtr bitmap = IntPtr.Zero;
        IShellItemImageFactory item = null;
        try {
            Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
            SHCreateItemFromParsingName("shell:AppsFolder\\" + appId, IntPtr.Zero, ref iid, out item);
            if (item.GetImage(new Size { cx = 64, cy = 64 }, 4, out bitmap) != 0 || bitmap == IntPtr.Zero) return ReadLegacy("shell:AppsFolder\\" + appId);
            return EncodeBitmap(bitmap) ?? ReadLegacy("shell:AppsFolder\\" + appId);
        } catch { return null; }
        finally {
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (item != null) Marshal.ReleaseComObject(item);
        }
    }
}
'@
$hasIcons = $true
try { Add-Type -TypeDefinition $iconSource -ReferencedAssemblies System.Drawing -ErrorAction Stop }
catch { $hasIcons = $false }
$apps = @(Get-StartApps | Where-Object { $_.Name -and $_.AppID } | ForEach-Object {
    $icon = $null
    if ($hasIcons) { $icon = [LumeShellIcon]::Read($_.AppID) }
    [PSCustomObject]@{ name = $_.Name; appId = $_.AppID; icon = $icon }
})
ConvertTo-Json -InputObject $apps -Depth 3 -Compress
