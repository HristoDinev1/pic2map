import test from 'node:test';
import assert from 'node:assert/strict';
import { readExifGps } from '../js/exif.js';

// Build a minimal-but-valid JPEG containing an EXIF APP1 segment with a GPS
// IFD (little-endian TIFF), entirely by hand — the same way the parser reads it.
function buildJpegWithGps({ latRef = 'N', lngRef = 'E', lat = [42, 41, 51.72], lng = [23, 19, 18.84], dateTimeOriginal = '2024:06:01 12:34:56' } = {}) {
  // TIFF layout (offsets relative to TIFF base):
  //   0   "II" 42, IFD0 @ 8
  //   8   IFD0: 2 entries (GPS pointer, EXIF pointer), next=0      → 8+2+24+4 = 38
  //   38  EXIF IFD: 1 entry (DateTimeOriginal), next=0             → 38+2+12+4 = 56
  //   56  DateTimeOriginal ASCII (20 bytes)                        → 76
  //   76  GPS IFD: 4 entries, next=0                               → 76+2+48+4 = 130
  //   130 lat rationals (24 bytes)                                 → 154
  //   154 lng rationals (24 bytes)                                 → 178
  const tiff = new ArrayBuffer(178);
  const v = new DataView(tiff);
  const LE = true;
  v.setUint16(0, 0x4949, false);      // "II"
  v.setUint16(2, 42, LE);
  v.setUint32(4, 8, LE);              // IFD0 offset

  // IFD0
  v.setUint16(8, 2, LE);
  writeEntry(v, 10, 0x8769, 4, 1, 38, LE);   // EXIF IFD pointer
  writeEntry(v, 22, 0x8825, 4, 1, 76, LE);   // GPS IFD pointer
  v.setUint32(34, 0, LE);

  // EXIF IFD with DateTimeOriginal (ASCII, 20 bytes incl. NUL → stored at 56)
  v.setUint16(38, 1, LE);
  writeEntry(v, 40, 0x9003, 2, 20, 56, LE);
  v.setUint32(52, 0, LE);
  for (let i = 0; i < dateTimeOriginal.length && i < 19; i++) v.setUint8(56 + i, dateTimeOriginal.charCodeAt(i));

  // GPS IFD
  v.setUint16(76, 4, LE);
  writeEntryInlineAscii(v, 78, 0x0001, latRef, LE);   // GPSLatitudeRef
  writeEntry(v, 90, 0x0002, 5, 3, 130, LE);           // GPSLatitude
  writeEntryInlineAscii(v, 102, 0x0003, lngRef, LE);  // GPSLongitudeRef
  writeEntry(v, 114, 0x0004, 5, 3, 154, LE);          // GPSLongitude
  v.setUint32(126, 0, LE);

  writeRationals(v, 130, lat, LE);
  writeRationals(v, 154, lng, LE);

  // Wrap in JPEG: SOI + APP1("Exif\0\0" + tiff) + EOI
  const payloadLen = 6 + tiff.byteLength;
  const out = new Uint8Array(2 + 4 + payloadLen + 2);
  let o = 0;
  out[o++] = 0xff; out[o++] = 0xd8;                       // SOI
  out[o++] = 0xff; out[o++] = 0xe1;                       // APP1
  out[o++] = (payloadLen + 2) >> 8; out[o++] = (payloadLen + 2) & 0xff;
  for (const c of 'Exif') out[o++] = c.charCodeAt(0);
  out[o++] = 0; out[o++] = 0;
  out.set(new Uint8Array(tiff), o); o += tiff.byteLength;
  out[o++] = 0xff; out[o++] = 0xd9;                       // EOI
  return out.buffer;
}

function writeEntry(v, off, tag, type, count, value, LE) {
  v.setUint16(off, tag, LE);
  v.setUint16(off + 2, type, LE);
  v.setUint32(off + 4, count, LE);
  v.setUint32(off + 8, value, LE);
}
function writeEntryInlineAscii(v, off, tag, str, LE) {
  v.setUint16(off, tag, LE);
  v.setUint16(off + 2, 2, LE);          // ASCII
  v.setUint32(off + 4, str.length + 1, LE);
  for (let i = 0; i < str.length; i++) v.setUint8(off + 8 + i, str.charCodeAt(i));
}
function writeRationals(v, off, values, LE) {
  for (let i = 0; i < values.length; i++) {
    v.setUint32(off + i * 8, Math.round(values[i] * 10000), LE);
    v.setUint32(off + i * 8 + 4, 10000, LE);
  }
}

test('reads decimal GPS from a JPEG EXIF block', async () => {
  const gps = await readExifGps(buildJpegWithGps());
  assert.ok(gps);
  const expectedLat = 42 + 41 / 60 + 51.72 / 3600;
  const expectedLng = 23 + 19 / 60 + 18.84 / 3600;
  assert.ok(Math.abs(gps.latitude - expectedLat) < 1e-6, `${gps.latitude}`);
  assert.ok(Math.abs(gps.longitude - expectedLng) < 1e-6, `${gps.longitude}`);
  assert.equal(gps.capturedAt, '2024-06-01T12:34:56');
});

test('applies S/W hemisphere signs', async () => {
  const gps = await readExifGps(buildJpegWithGps({ latRef: 'S', lngRef: 'W', lat: [33, 52, 7.68], lng: [70, 38, 0] }));
  assert.ok(gps.latitude < 0 && gps.longitude < 0);
});

test('returns null for a JPEG without EXIF', async () => {
  const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]).buffer;
  assert.equal(await readExifGps(plain), null);
});

test('returns null for non-image garbage and truncated input', async () => {
  assert.equal(await readExifGps(new Uint8Array([1, 2, 3]).buffer), null);
  assert.equal(await readExifGps(new TextEncoder().encode('hello world').buffer), null);
});

test('rejects the 0,0 "no fix" placeholder', async () => {
  const gps = await readExifGps(buildJpegWithGps({ lat: [0, 0, 0], lng: [0, 0, 0] }));
  assert.equal(gps, null);
});
