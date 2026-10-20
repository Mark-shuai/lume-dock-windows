param([switch] $Native)
$ErrorActionPreference = 'Stop'
$script = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/list-apps.ps1'))
$source = [regex]::Match($script, '(?s)\$iconSource = @''\r?\n(.*?)\r?\n''@').Groups[1].Value
if (-not $source) { throw 'Missing production icon converter' }
$fixture = @'
public static class LumeBitmapFixture {
    [StructLayout(LayoutKind.Sequential)] struct Info {
        public uint size; public int width, height; public ushort planes, bits;
        public uint compression, sizeImage; public int xppm, yppm; public uint used, important;
    }
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref Info info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr handle);
    public static string Encode(bool legacy) {
        var info = new Info { size=40, width=4, height=-1, planes=1, bits=32 };
        IntPtr bits;
        IntPtr bitmap = CreateDIBSection(IntPtr.Zero, ref info, 0, out bits, IntPtr.Zero, 0);
        if (bitmap == IntPtr.Zero) throw new Exception("CreateDIBSection failed");
        try {
            byte[] pixels = legacy ? new byte[16] : new byte[] {0,0,0,0, 0,0,0,255, 16,32,64,128, 255,255,255,255};
            Marshal.Copy(pixels, 0, bits, pixels.Length);
            return LumeShellIcon.EncodeBitmap(bitmap);
        } finally { DeleteObject(bitmap); }
    }
}
'@
$source += "`n" + $fixture
if ($PSVersionTable.PSEdition -eq 'Core') {
    $references = @('System.Drawing.Common', 'System.Drawing.Primitives', 'System.Runtime.InteropServices')
    if (Test-Path (Join-Path $PSHOME 'System.Private.Windows.Core.dll')) { $references += 'System.Private.Windows.Core' }
    Add-Type -TypeDefinition $source -ReferencedAssemblies $references
} else { Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing }
[byte[]] $pixels = @(11,22,33,0, 0,0,0,255, 16,32,64,128, 255,255,255,255)
if (-not [LumeShellIcon]::StraightAlpha($pixels)) { throw 'Alpha not detected' }
if (($pixels -join ',') -ne '0,0,0,0,0,0,0,255,32,64,128,128,255,255,255,255') { throw 'Transparency, real black, or half-alpha color changed' }
if ([LumeShellIcon]::StraightAlpha([byte[]]@(0,0,0,0, 0,0,0,0))) { throw 'Legacy empty alpha must use mask fallback' }
if (-not $Native) { 'Icon C# compiled; alpha conversion passed: transparent pixels, opaque black, white and premultiplied edges.'; exit 0 }
# Exercise the production GetDIBits/LockBits/PNG path on Windows with known pixels.

if ($null -ne [LumeBitmapFixture]::Encode($true)) { throw 'Missing alpha must use legacy mask' }
[LumeBitmapFixture]::Encode($false)
