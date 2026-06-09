import test from 'node:test';
import assert from 'node:assert/strict';
import { readExifGps } from '../js/exif.js';
import { buildJpegWithGps } from './exif-fixture.js';

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
