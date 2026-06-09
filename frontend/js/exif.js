// Minimal hand-written EXIF reader (no libraries) — just enough to answer
// "does this photo have GPS coordinates, and when was it taken?" before the
// file is even uploaded. The authoritative extraction still happens in the
// image-processor Lambda; this only powers upload-page previews.
//
// Supports JPEG (APP1/Exif segment) and bare TIFF. PNG/WebP/HEIC simply
// return null — the Lambda handles those after upload.

const GPS_IFD_POINTER = 0x8825;
const EXIF_IFD_POINTER = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME = 0x0132;

/**
 * @param {File|Blob|ArrayBuffer} input
 * @returns {Promise<{latitude:number, longitude:number, capturedAt:string|null}|null>}
 *          null when the file has no readable EXIF GPS block.
 */
export async function readExifGps(input) {
  try {
    const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    const view = new DataView(buf);
    const tiffOffset = findTiffHeader(view);
    if (tiffOffset == null) return null;
    return parseTiff(view, tiffOffset);
  } catch {
    return null; // never let a malformed file break the upload flow
  }
}

/** Locate the TIFF header: directly at 0 for .tif, inside APP1 for JPEG. */
function findTiffHeader(view) {
  if (view.byteLength < 8) return null;
  const w0 = view.getUint16(0, false);
  if (w0 === 0x4949 || w0 === 0x4d4d) return 0;       // bare TIFF ("II"/"MM")
  if (w0 !== 0xffd8) return null;                      // not a JPEG either

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) return null; // start-of-scan / EOI — no EXIF found
    const size = view.getUint16(offset + 2, false);
    if (marker === 0xe1 && size >= 8) {                  // APP1
      // "Exif\0\0" signature
      if (view.getUint32(offset + 4, false) === 0x45786966 && view.getUint16(offset + 8, false) === 0x0000) {
        return offset + 10;
      }
    }
    offset += 2 + size;
  }
  return null;
}

function parseTiff(view, base) {
  const little = view.getUint16(base, false) === 0x4949;
  if (view.getUint16(base + 2, little) !== 42) return null;
  const ifd0 = base + view.getUint32(base + 4, little);

  let gpsIfd = null;
  let exifIfd = null;
  let capturedAt = null;

  forEachTag(view, base, ifd0, little, (tag, type, count, valueOffset) => {
    if (tag === GPS_IFD_POINTER) gpsIfd = base + view.getUint32(valueOffset, little);
    if (tag === EXIF_IFD_POINTER) exifIfd = base + view.getUint32(valueOffset, little);
    if (tag === TAG_DATETIME) capturedAt = readAscii(view, base, type, count, valueOffset, little) || capturedAt;
  });

  if (exifIfd != null) {
    forEachTag(view, base, exifIfd, little, (tag, type, count, valueOffset) => {
      if (tag === TAG_DATETIME_ORIGINAL) {
        capturedAt = readAscii(view, base, type, count, valueOffset, little) || capturedAt;
      }
    });
  }

  if (gpsIfd == null) return null;

  let latRef = null, lngRef = null, lat = null, lng = null;
  forEachTag(view, base, gpsIfd, little, (tag, type, count, valueOffset) => {
    if (tag === 1) latRef = readAscii(view, base, type, count, valueOffset, little);
    if (tag === 2) lat = readRationals(view, base, count, valueOffset, little);
    if (tag === 3) lngRef = readAscii(view, base, type, count, valueOffset, little);
    if (tag === 4) lng = readRationals(view, base, count, valueOffset, little);
  });

  if (!lat || !lng || lat.length < 1 || lng.length < 1) return null;
  const latitude = dmsToDecimal(lat) * (latRef && latRef.toUpperCase().startsWith('S') ? -1 : 1);
  const longitude = dmsToDecimal(lng) * (lngRef && lngRef.toUpperCase().startsWith('W') ? -1 : 1);
  if (!isFinite(latitude) || !isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;  // common "no fix" placeholder
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude, capturedAt: normalizeExifDate(capturedAt) };
}

/** Walk one IFD, invoking cb(tag, type, count, valueOffset) per entry. */
function forEachTag(view, base, ifdOffset, little, cb) {
  if (ifdOffset < 0 || ifdOffset + 2 > view.byteLength) return;
  const entries = view.getUint16(ifdOffset, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) return;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const count = view.getUint32(entry + 4, little);
    const size = typeSize(type) * count;
    const valueOffset = size <= 4 ? entry + 8 : base + view.getUint32(entry + 8, little);
    if (valueOffset + size > view.byteLength) continue;
    cb(tag, type, count, valueOffset);
  }
}

function typeSize(type) {
  return { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
}

function readAscii(view, base, type, count, offset, little) {
  if (type !== 2) return null;
  let out = '';
  for (let i = 0; i < count; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out.trim() || null;
}

function readRationals(view, base, count, offset, little) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const num = view.getUint32(offset + i * 8, little);
    const den = view.getUint32(offset + i * 8 + 4, little);
    out.push(den === 0 ? 0 : num / den);
  }
  return out;
}

function dmsToDecimal(parts) {
  const [d = 0, m = 0, s = 0] = parts;
  return d + m / 60 + s / 3600;
}

/** EXIF "YYYY:MM:DD HH:MM:SS" → ISO-ish string, or null. */
function normalizeExifDate(value) {
  if (!value) return null;
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}
