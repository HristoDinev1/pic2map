import test from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, clusterPoints, boundsView, TILE_SIZE, MIN_ZOOM } from '../js/map/custom-map.js';

test('project: known anchor points', () => {
  // lat 0 / lng 0 is the exact center of the world at every zoom.
  for (const zoom of [2, 5, 10]) {
    const world = TILE_SIZE * 2 ** zoom;
    const p = project(0, 0, zoom);
    assert.ok(Math.abs(p.x - world / 2) < 1e-6);
    assert.ok(Math.abs(p.y - world / 2) < 1e-6);
  }
  // lng -180 maps to x = 0.
  assert.ok(Math.abs(project(0, -180, 3).x) < 1e-6);
});

test('project/unproject round-trip is lossless', () => {
  const samples = [
    [42.6977, 23.3219],   // Sofia
    [-33.8688, 151.2093], // Sydney
    [64.1466, -21.9426],  // Reykjavik
    [0.01, -0.01],
    [-85, 179.99],
  ];
  for (const [lat, lng] of samples) {
    const p = project(lat, lng, 12);
    const back = unproject(p.x, p.y, 12);
    assert.ok(Math.abs(back.lat - lat) < 1e-6, `lat ${lat} -> ${back.lat}`);
    assert.ok(Math.abs(back.lng - lng) < 1e-6, `lng ${lng} -> ${back.lng}`);
  }
});

test('project clamps latitudes beyond the Web-Mercator limit', () => {
  const top = project(90, 0, 4);
  const limit = project(85.05112878, 0, 4);
  assert.equal(top.y, limit.y);
});

test('clusterPoints groups nearby points and keeps far ones separate', () => {
  const near = [
    { x: 100, y: 100 }, { x: 110, y: 105 }, { x: 95, y: 92 },
  ];
  const far = { x: 500, y: 500 };
  const clusters = clusterPoints([...near, far], 44);
  assert.equal(clusters.length, 2);
  const big = clusters.find((c) => c.points.length === 3);
  assert.ok(big, 'three nearby points form one cluster');
  // Cluster center is the centroid.
  assert.ok(Math.abs(big.x - (100 + 110 + 95) / 3) < 1e-9);
  assert.equal(clusters.find((c) => c.points.length === 1).points[0], far);
});

test('clusterPoints with empty input', () => {
  assert.deepEqual(clusterPoints([], 44), []);
});

test('boundsView fits all points inside the viewport', () => {
  const items = [
    { latitude: 42.6977, longitude: 23.3219 },
    { latitude: 48.8566, longitude: 2.3522 },
    { latitude: 51.5074, longitude: -0.1278 },
  ];
  const view = boundsView(items, 800, 600);
  assert.ok(view);
  assert.ok(view.zoom >= MIN_ZOOM && view.zoom <= 16);
  // At the chosen zoom, the lat/lng extent must fit within the padded viewport.
  const a = project(51.5074, -0.1278, view.zoom);
  const b = project(42.6977, 23.3219, view.zoom);
  assert.ok(Math.abs(b.x - a.x) <= 800 - 2 * 48 + 1);
  assert.ok(Math.abs(b.y - a.y) <= 600 - 2 * 48 + 1);
});

test('boundsView: single point gets max zoom, no points gives null', () => {
  const one = boundsView([{ latitude: 10, longitude: 10 }], 800, 600, { maxZoom: 14 });
  assert.equal(one.zoom, 14);
  assert.deepEqual(one.center, [10, 10]);
  assert.equal(boundsView([], 800, 600), null);
  assert.equal(boundsView([{ latitude: null, longitude: null }], 800, 600), null);
});
