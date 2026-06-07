import { el, clear } from '../dom.js';

// A small from-scratch slippy-map widget: OpenStreetMap raster tiles fetched
// directly by URL (no Leaflet/Google Maps JS), Web-Mercator projection done by
// hand, drag-to-pan + wheel/button zoom via pointer events, and simple
// pixel-distance clustering for markers. Replaces react-leaflet entirely.

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const TILE_SERVERS = ['a', 'b', 'c'];
const CLUSTER_RADIUS = 44;

/** Web Mercator projection: lat/lng -> pixel coords in the "world" at a given zoom. */
function project(lat, lng, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** Greedy pixel-distance clustering — groups nearby markers into one bubble. */
function clusterPoints(points, radius) {
  const used = new Array(points.length).fill(false);
  const clusters = [];
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const group = [points[i]];
    used[i] = true;
    for (let j = i + 1; j < points.length; j++) {
      if (used[j]) continue;
      if (Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y) <= radius) {
        group.push(points[j]);
        used[j] = true;
      }
    }
    clusters.push({
      points: group,
      x: group.reduce((s, p) => s + p.x, 0) / group.length,
      y: group.reduce((s, p) => s + p.y, 0) / group.length,
    });
  }
  return clusters;
}

export class CustomMap {
  constructor(container, { center = [42.6977, 23.3219], zoom = 4 } = {}) {
    this.container = container;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.markers = [];
    this.tiles = new Map();
    this.popupEl = null;

    this.viewport = el('div', { class: 'map-viewport' });
    this.tileLayer = el('div', { class: 'map-layer' });
    this.markerLayer = el('div', { class: 'map-layer' });
    this.viewport.append(this.tileLayer, this.markerLayer);

    const controls = el('div', { class: 'map-controls' }, [
      el('button', { type: 'button', title: 'Zoom in', onclick: () => this.zoomBy(1) }, '+'),
      el('button', { type: 'button', title: 'Zoom out', onclick: () => this.zoomBy(-1) }, '−'),
    ]);
    const attribution = el('div', { class: 'map-attribution' }, '© OpenStreetMap contributors');

    container.append(this.viewport, controls, attribution);

    const p = project(center[0], center[1], this.zoom);
    this.originX = p.x - this.width() / 2;
    this.originY = p.y - this.height() / 2;

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.viewport);
    requestAnimationFrame(() => this.render());
  }

  width()  { return this.viewport.clientWidth  || 1; }
  height() { return this.viewport.clientHeight || 1; }

  destroy() {
    this.resizeObserver.disconnect();
  }

  setMarkers(markers) {
    this.markers = markers.filter((m) => m.latitude != null && m.longitude != null);
    this.renderMarkers();
  }

  zoomBy(delta) { this.zoomAt(this.width() / 2, this.height() / 2, delta); }

  zoomAt(screenX, screenY, delta) {
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom + delta));
    if (newZoom === this.zoom) return;
    const scale = 2 ** (newZoom - this.zoom);
    const worldX = (this.originX + screenX) * scale;
    const worldY = (this.originY + screenY) * scale;
    this.zoom = newZoom;
    this.originX = worldX - screenX;
    this.originY = worldY - screenY;
    this.render();
  }

  bindEvents() {
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, startOriginX = 0, startOriginY = 0;
    let raf = null;

    const scheduleRender = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.render());
    };

    this.viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      startOriginX = this.originX; startOriginY = this.originY;
      this.viewport.classList.add('dragging');
      this.viewport.setPointerCapture(e.pointerId);
    });
    this.viewport.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      this.originX = startOriginX - dx;
      this.originY = startOriginY - dy;
      scheduleRender();
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      this.viewport.classList.remove('dragging');
      try { this.viewport.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    this.viewport.addEventListener('pointerup', endDrag);
    this.viewport.addEventListener('pointercancel', endDrag);
    this.viewport.addEventListener('pointerleave', endDrag);

    // Suppress the click that follows a drag (so dragging doesn't close popups).
    this.viewport.addEventListener('click', (e) => {
      if (moved) { e.stopPropagation(); moved = false; }
      else this.closePopup();
    }, true);

    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  render() {
    this.renderTiles();
    this.renderMarkers();
  }

  renderTiles() {
    const width = this.width(), height = this.height();
    const n = 2 ** this.zoom;
    const minTx = Math.floor(this.originX / TILE_SIZE);
    const maxTx = Math.floor((this.originX + width) / TILE_SIZE);
    const minTy = Math.max(0, Math.floor(this.originY / TILE_SIZE));
    const maxTy = Math.min(n - 1, Math.floor((this.originY + height) / TILE_SIZE));

    const wanted = new Set();
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        const wrappedX = ((tx % n) + n) % n;
        const key = `${this.zoom}/${tx}/${ty}`;
        wanted.add(key);
        let img = this.tiles.get(key);
        if (!img) {
          const server = TILE_SERVERS[(wrappedX + ty) % TILE_SERVERS.length];
          img = el('img', {
            class: 'map-tile', alt: '', draggable: false,
            src: `https://${server}.tile.openstreetmap.org/${this.zoom}/${wrappedX}/${ty}.png`,
          });
          this.tileLayer.appendChild(img);
          this.tiles.set(key, img);
        }
        img.style.left = `${tx * TILE_SIZE - this.originX}px`;
        img.style.top = `${ty * TILE_SIZE - this.originY}px`;
      }
    }
    for (const [key, img] of this.tiles) {
      if (!wanted.has(key)) { img.remove(); this.tiles.delete(key); }
    }
  }

  renderMarkers() {
    const openPhotoId = this.popupEl ? this.popupEl.dataset.photoId : null;
    clear(this.markerLayer);
    this.popupEl = null;

    const width = this.width(), height = this.height();
    const points = this.markers
      .map((marker) => {
        const p = project(marker.latitude, marker.longitude, this.zoom);
        return { marker, x: p.x - this.originX, y: p.y - this.originY };
      })
      .filter((p) => p.x > -60 && p.x < width + 60 && p.y > -60 && p.y < height + 60);

    let reopen = null;
    for (const cluster of clusterPoints(points, CLUSTER_RADIUS)) {
      if (cluster.points.length === 1) {
        const { marker, x, y } = cluster.points[0];
        this.markerLayer.appendChild(el('div', {
          class: 'map-marker', style: `left:${x}px;top:${y}px`, title: marker.title,
          onclick: (e) => { e.stopPropagation(); this.showPopup(marker, x, y); },
        }));
        if (marker.id === openPhotoId) reopen = { marker, x, y };
      } else {
        const { x, y } = cluster;
        this.markerLayer.appendChild(el('div', {
          class: 'map-marker cluster', style: `left:${x}px;top:${y}px`,
          title: `${cluster.points.length} photos here — click to zoom in`,
          onclick: (e) => { e.stopPropagation(); this.zoomAt(x, y, 2); },
        }, String(cluster.points.length)));
      }
    }
    if (reopen) this.showPopup(reopen.marker, reopen.x, reopen.y);
  }

  showPopup(photo, x, y) {
    this.closePopup();
    const popup = el('div', { class: 'map-popup', style: `left:${x}px;top:${y}px`, 'data-photo-id': photo.id }, [
      el('button', { class: 'close', type: 'button', onclick: (e) => { e.stopPropagation(); this.closePopup(); } }, '✕'),
      photo.urls.thumb ? el('img', { src: photo.urls.thumb, alt: photo.title }) : null,
      el('div', { class: 'title' }, photo.title),
      el('div', { class: 'sub' }, `by ${photo.ownerUsername || 'unknown'}`),
      el('div', { class: 'sub' }, `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`),
      el('div', { class: 'sub' }, `Uploaded ${new Date(photo.createdAt).toLocaleDateString()}`),
    ]);
    this.markerLayer.appendChild(popup);
    this.popupEl = popup;
  }

  closePopup() {
    if (this.popupEl) { this.popupEl.remove(); this.popupEl = null; }
  }
}
