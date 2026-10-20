const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ICON_LENGTH = 48 * 1024;

function rasterSize(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      offset += length;
    }
  }
  throw new Error('图片格式无效，请选择有效的图标图片');
}
function checkSize(size) {
  if (!size.width || !size.height || size.width > 4096 || size.height > 4096) throw new Error('图片边长需在 1–4096 像素之间');
}

function decodeIco(bytes, nativeImage) {
  const count = bytes.readUInt16LE(4);
  if (!count || count > 256 || 6 + count * 16 > bytes.length) throw new Error('ICO 图标目录无效');
  const entries = Array.from({ length: count }, (_, i) => {
    const offset = 6 + i * 16;
    return { width: bytes[offset] || 256, height: bytes[offset + 1] || 256, length: bytes.readUInt32LE(offset + 8), start: bytes.readUInt32LE(offset + 12) };
  }).filter(entry => entry.length && entry.start >= 6 + count * 16 && entry.start + entry.length <= bytes.length)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  for (const entry of entries) {
    const payload = bytes.subarray(entry.start, entry.start + entry.length);
    try {
      if (payload[0] === 137) { checkSize(rasterSize(payload)); const image = nativeImage.createFromBuffer(payload); if (!image.isEmpty()) return image; continue; }
      // Classic uncompressed 24/32-bit ICO frames store bottom-up BGR(A) and an
      // AND transparency mask. Keep true black pixels and premultiply once.
      if (payload.length < 40 || payload.readUInt32LE(0) !== 40 || payload.readUInt32LE(16) !== 0) continue;
      const width = payload.readInt32LE(4), height = payload.readInt32LE(8) / 2, bits = payload.readUInt16LE(14);
      if (width !== entry.width || height !== entry.height || ![24, 32].includes(bits)) continue;
      const stride = Math.ceil(width * bits / 32) * 4, maskStride = Math.ceil(width / 32) * 4;
      const maskStart = 40 + stride * height;
      if (maskStart > payload.length || (bits === 24 && maskStart + maskStride * height > payload.length)) continue;
      let alpha = false;
      if (bits === 32) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (payload[40 + y * stride + x * 4 + 3]) alpha = true;
      const bitmap = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const row = height - 1 - y, input = 40 + row * stride + x * (bits / 8), output = (y * width + x) * 4;
        const masked = maskStart + maskStride * height <= payload.length && (payload[maskStart + row * maskStride + (x >> 3)] & (0x80 >> (x % 8)));
        const a = alpha ? payload[input + 3] : masked ? 0 : 255;
        for (let channel = 0; channel < 3; channel++) bitmap[output + channel] = Math.round(payload[input + channel] * a / 255);
        bitmap[output + 3] = a;
      }
      return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
    } catch { /* Try another valid frame in this ICO. */ }
  }
  throw new Error('无法读取此 ICO，请换用 PNG 图片');
}

// Decode only bounded raster images. SVG and executable icon resources are not
// accepted here; Windows native application artwork has its own loader.
async function readCustomIcon(file, nativeImage) {
  if (typeof file !== 'string' || !/\.(png|jpe?g|ico)$/i.test(path.extname(file))) throw new Error('请选择 PNG、JPG 或 ICO 图片');
  const handle = await fs.promises.open(file, 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES || stat.size < 1) throw new Error('图标图片需小于 8 MB');
    // A fixed buffer also bounds reads if another process changes the file.
    const buffer = Buffer.alloc(stat.size);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    bytes = buffer.subarray(0, result.bytesRead);
  } finally { await handle.close(); }
  const ico = bytes.length >= 22 && bytes.readUInt32LE(0) === 0x00010000;
  if (!ico) checkSize(rasterSize(bytes));
  const image = ico ? decodeIco(bytes, nativeImage) : nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('无法读取这张图片，请换一张图片');
  const size = image.getSize();
  checkSize(size);
  for (const edge of [128, 96, 64]) {
    const factor = Math.min(1, edge / Math.max(size.width, size.height));
    const resized = image.resize({ width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)), quality: 'good' });
    const icon = `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    if (icon.length <= MAX_ICON_LENGTH) return icon;
  }
  throw new Error('图标图片压缩失败，请换一张图片');
}

module.exports = { readCustomIcon, rasterSize, MAX_FILE_BYTES, MAX_ICON_LENGTH };
