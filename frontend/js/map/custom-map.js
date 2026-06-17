import { el, clear } from '../dom.js';

// A from-scratch slippy-map widget: OpenStreetMap raster tiles fetched directly
// by URL (no Leaflet/Google Maps JS), Web-Mercator projection done by hand.
//
// Interaction model (kept deliberately close to "normal" web maps):
//   • drag to pan (mouse / touch / pen via pointer events)
//   • wheel to zoom at the cursor, double-click to zoom in
//   • two-finger pinch to zoom on touch screens
//   • keyboard: arrows pan, + / - zoom (viewport is focusable)
//   • zoom buttons, "fit all photos" and "my location" controls
//   • panning is clamped so you can't drag the world off-screen vertically;
//     longitude wraps around the antimeridian like a real slippy map
//   • tiles from the previous zoom level stay on screen (scaled) until the new
//     level has loaded, so zooming no longer flashes a blank grey viewport
//   • markers are photo thumbnails; nearby ones cluster into a count bubble
//     that zooms-to-fit when clicked
//   • optional "picker" mode: click the map to choose a lat/lng (used by the
//     photo editor to set GPS visually)

export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;
const TILE_SERVERS = ['a', 'b', 'c'];
const CLUSTER_RADIUS = 48;
const MAX_TILE_CACHE = 220;

/** Web Mercator projection: lat/lng -> pixel coords in the "world" at a given zoom. */
export function project(lat, lng, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sinLat = Math.sin((clamped * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** Inverse Web Mercator: world pixel coords -> lat/lng. */
export function unproject(x, y, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  let lng = (x / scale) * 360 - 180;
  lng = ((lng + 180) % 360 + 360) % 360 - 180; // wrap to [-180, 180)
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** Greedy pixel-distance clustering — groups nearby markers into one bubble. */
export function clusterPoints(points, radius = CLUSTER_RADIUS) {
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

/** Zoom level + center that fit a set of {latitude, longitude} into width×height px. */
export function boundsView(items, width, height, { padding = 48, maxZoom = 16 } = {}) {
  const pts = items.filter((m) => m.latitude != null && m.longitude != null);
  if (!pts.length) return null;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const p of pts) {
    minLat = Math.min(minLat, p.latitude); maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude); maxLng = Math.max(maxLng, p.longitude);
  }
  const usableW = Math.max(40, width - padding * 2);
  const usableH = Math.max(40, height - padding * 2);
  let zoom = maxZoom;
  for (; zoom > MIN_ZOOM; zoom--) {
    const a = project(maxLat, minLng, zoom);
    const b = project(minLat, maxLng, zoom);
    if (b.x - a.x <= usableW && b.y - a.y <= usableH) break;
  }
  return { center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2], zoom };
}

export class CustomMap {
  /**
   * @param {HTMLElement} container
   * @param {object} opts
   *   center, zoom            — initial view
   *   onPick(lat, lng)        — enables picker mode (click selects a location)
   *   popupActions(photo)     — optional extra node rendered inside marker popups
   *   showFitControl          — show the "fit all markers" button (default true)
   *   showLocateControl       — show the "my location" button (default true)
   */
  constructor(container, opts = {}) {
    const { center = [42.6977, 23.3219], zoom = 4 } = opts;
    this.opts = opts;
    this.container = container;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.markers = [];
    this.tiles = new Map();       // "z/x/y" -> img
    this.popupEl = null;
    this.hoverPopupEl = null;     // lightweight preview shown on marker hover
    this.pickMarker = null;       // [lat, lng] draft pin in picker mode
    this.selfLocation = null;     // [lat, lng] from geolocation

    this.viewport = el('div', { class: 'map-viewport', tabindex: '0', role: 'application', 'aria-label': 'Interactive map' });
    // Explicit z-index on the layers (they share the .map-layer class) so the
    // marker layer always paints above the tile layer regardless of how the
    // browser stacks the children's own z-indexes.
    this.tileLayer = el('div', { class: 'map-layer', style: 'z-index:1' });
    this.markerLayer = el('div', { class: 'map-layer', style: 'z-index:2' });
    this.viewport.append(this.tileLayer, this.markerLayer);

    const controls = el('div', { class: 'map-controls' }, [
      el('button', { type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => this.zoomBy(1) }, '+'),
      el('button', { type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => this.zoomBy(-1) }, '−'),
      opts.showFitControl !== false
        ? el('button', { type: 'button', title: 'Fit all photos', 'aria-label': 'Fit all photos', onclick: () => this.fitToMarkers() }, '⛶')
        : null,
      opts.showLocateControl !== false
        ? el('button', { type: 'button', title: 'My location', 'aria-label': 'My location', onclick: () => this.locate() }, '◎')
        : null,
    ]);
    this.scaleBar = el('div', { class: 'map-scale' }, [el('span')]);
    const attribution = el('div', { class: 'map-attribution' },
      el('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© OpenStreetMap contributors'));
    this.hintEl = opts.onPick
      ? el('div', { class: 'map-hint' }, 'Click the map to choose a location')
      : null;

    container.append(this.viewport, controls, this.scaleBar, attribution);
    if (this.hintEl) container.append(this.hintEl);

    const p = project(center[0], center[1], this.zoom);
    this.originX = p.x - this.width() / 2;
    this.originY = p.y - this.height() / 2;

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => { this.clampOrigin(); this.render(); });
    this.resizeObserver.observe(this.viewport);
    requestAnimationFrame(() => { this.clampOrigin(); this.render(); });
  }

  width()  { return this.viewport.clientWidth  || 1; }
  height() { return this.viewport.clientHeight || 1; }
  worldSize() { return TILE_SIZE * 2 ** this.zoom; }

  destroy() { this.resizeObserver.disconnect(); }

  /* ------------------------------------------------ view state ---------- */

  /** Keep the view inside the world vertically; X wraps so it's left free. */
  clampOrigin() {
    const world = this.worldSize();
    const h = this.height();
    if (world <= h) this.originY = (world - h) / 2;             // world shorter than viewport → center it
    else this.originY = Math.min(world - h, Math.max(0, this.originY));
  }

  setView(center, zoom = this.zoom) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
    const p = project(center[0], center[1], this.zoom);
    this.originX = p.x - this.width() / 2;
    this.originY = p.y - this.height() / 2;
    this.clampOrigin();
    this.render();
  }

  centerLatLng() {
    return unproject(this.originX + this.width() / 2, this.originY + this.height() / 2, this.zoom);
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
    this.clampOrigin();
    this.render();
  }

  /** Zoom + center so all current markers (or given items) are visible. */
  fitToMarkers(items = this.markers, fitOpts = {}) {
    const view = boundsView(items, this.width(), this.height(), fitOpts);
    if (view) this.setView(view.center, view.zoom);
    return !!view;
  }

  /** Browser geolocation → pan there and show a blue "you are here" dot. */
  locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.selfLocation = [pos.coords.latitude, pos.coords.longitude];
        this.setView(this.selfLocation, Math.max(this.zoom, 13));
      },
      () => { /* permission denied — nothing to do */ },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  setMarkers(markers) {
    this.markers = markers.filter((m) => m.latitude != null && m.longitude != null);
    this.renderMarkers();
  }

  setPickMarker(lat, lng) {
    this.pickMarker = lat != null && lng != null ? [lat, lng] : null;
    this.renderMarkers();
  }

  /* ------------------------------------------------ events -------------- */

  bindEvents() {
    const pointers = new Map(); // pointerId -> {x, y}
    let moved = false;
    let panAnchor = null;       // {x, y, originX, originY}
    let pinchStartDist = 0;
    let raf = null;

    const scheduleRender = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.render());
    };
    const rect = () => this.viewport.getBoundingClientRect();
    const startPan = (x, y) => { panAnchor = { x, y, originX: this.originX, originY: this.originY }; };

    this.viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      this.viewport.classList.add('dragging');
      try { this.viewport.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (pointers.size === 1) {
        startPan(e.clientX, e.clientY);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        panAnchor = null;
      }
    });

    this.viewport.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1 && panAnchor) {
        const dx = e.clientX - panAnchor.x, dy = e.clientY - panAnchor.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        this.originX = panAnchor.originX - dx;
        this.originY = panAnchor.originY - dy;
        this.clampOrigin();
        scheduleRender();
      } else if (pointers.size === 2) {
        // Pinch zoom: when the finger distance grows/shrinks enough, step the
        // zoom at the midpoint (integer zoom levels, like wheel zoom).
        moved = true;
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const r = rect();
        const midX = (a.x + b.x) / 2 - r.left;
        const midY = (a.y + b.y) / 2 - r.top;
        if (pinchStartDist > 0) {
          const ratio = dist / pinchStartDist;
          if (ratio > 1.35) { this.zoomAt(midX, midY, 1); pinchStartDist = dist; }
          else if (ratio < 0.74) { this.zoomAt(midX, midY, -1); pinchStartDist = dist; }
        }
      }
    });

    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      try { this.viewport.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        startPan(p.x, p.y);
      } else if (pointers.size === 0) {
        panAnchor = null;
        this.viewport.classList.remove('dragging');
      }
    };
    this.viewport.addEventListener('pointerup', endPointer);
    this.viewport.addEventListener('pointercancel', endPointer);

    // Click: suppress the click that follows a drag; otherwise close popups,
    // or — in picker mode — select the clicked location.
    this.viewport.addEventListener('click', (e) => {
      if (moved) { e.stopPropagation(); moved = false; return; }
      this.closePopup();
      if (this.opts.onPick) {
        const r = rect();
        const { lat, lng } = unproject(this.originX + (e.clientX - r.left), this.originY + (e.clientY - r.top), this.zoom);
        this.setPickMarker(lat, lng);
        this.opts.onPick(lat, lng);
      }
    }, true);

    this.viewport.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const r = rect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, 1);
    });

    // Wheel handling — split between pan (trackpad two-finger swipe) and zoom
    // (mouse wheel / trackpad pinch). Conventions used:
    //   • ctrlKey or metaKey set → pinch on Mac trackpad, or explicit zoom modifier → zoom
    //   • deltaMode === 1 (DOM_DELTA_LINE) → traditional mouse wheel → zoom
    //   • otherwise (DOM_DELTA_PIXEL with no modifier) → trackpad swipe → pan
    // Zoom uses an accumulator + threshold so a fast trackpad pinch doesn't
    // skip three zoom levels in a single event burst.
    let wheelAccum = 0;
    let wheelResetTimer = null;
    const ZOOM_STEP = 35;
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = rect();
      const isZoom = e.ctrlKey || e.metaKey || e.deltaMode === 1;
      if (isZoom) {
        wheelAccum += e.deltaY;
        clearTimeout(wheelResetTimer);
        wheelResetTimer = setTimeout(() => { wheelAccum = 0; }, 200);
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        while (wheelAccum <= -ZOOM_STEP) { this.zoomAt(sx, sy,  1); wheelAccum += ZOOM_STEP; }
        while (wheelAccum >=  ZOOM_STEP) { this.zoomAt(sx, sy, -1); wheelAccum -= ZOOM_STEP; }
      } else {
        // Two-finger swipe → pan. Slight damping so flicks aren't twitchy.
        this.originX += e.deltaX * 0.9;
        this.originY += e.deltaY * 0.9;
        this.clampOrigin();
        scheduleRender();
      }
    }, { passive: false });

    this.viewport.addEventListener('keydown', (e) => {
      const PAN = 80;
      switch (e.key) {
        case 'ArrowUp':    this.originY -= PAN; break;
        case 'ArrowDown':  this.originY += PAN; break;
        case 'ArrowLeft':  this.originX -= PAN; break;
        case 'ArrowRight': this.originX += PAN; break;
        case '+': case '=': this.zoomBy(1); return;
        case '-': case '_': this.zoomBy(-1); return;
        default: return;
      }
      e.preventDefault();
      this.clampOrigin();
      this.render();
    });
  }

  /* ------------------------------------------------ rendering ----------- */

  render() {
    this.renderTiles();
    this.renderMarkers();
    this.renderScale();
  }

  renderTiles() {
    const width = this.width(), height = this.height();
    const n = 2 ** this.zoom;
    const minTx = Math.floor(this.originX / TILE_SIZE);
    const maxTx = Math.floor((this.originX + width) / TILE_SIZE);
    const minTy = Math.max(0, Math.floor(this.originY / TILE_SIZE));
    const maxTy = Math.min(n - 1, Math.floor((this.originY + height) / TILE_SIZE));

    const wanted = new Set();
    let allLoaded = true;

    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        const wrappedX = ((tx % n) + n) % n;
        const key = `${this.zoom}/${wrappedX}/${ty}`;
        wanted.add(key);
        let img = this.tiles.get(key);
        if (!img) {
          const server = TILE_SERVERS[(wrappedX + ty) % TILE_SERVERS.length];
          img = el('img', {
            class: 'map-tile', alt: '', draggable: false,
            src: `https://${server}.tile.openstreetmap.org/${this.zoom}/${wrappedX}/${ty}.png`,
            onload: () => { img.classList.add('loaded'); this.pruneStaleTiles(); },
          });
          img.dataset.z = String(this.zoom);
          img.dataset.x = String(wrappedX);
          img.dataset.y = String(ty);
          this.tileLayer.appendChild(img);
          this.tiles.set(key, img);
        }
        if (!(img.complete && img.naturalWidth)) allLoaded = false;
        img.style.zIndex = '1';
        img.style.width = img.style.height = `${TILE_SIZE}px`;
        img.style.left = `${tx * TILE_SIZE - this.originX}px`;
        img.style.top = `${ty * TILE_SIZE - this.originY}px`;
      }
    }

    // Tiles from other zoom levels: keep them visible underneath (scaled) so
    // zooming doesn't flash an empty viewport; drop them once the current
    // level has fully loaded.
    for (const [key, img] of this.tiles) {
      if (wanted.has(key)) continue;
      const z = Number(img.dataset.z);
      if (z === this.zoom) { img.remove(); this.tiles.delete(key); continue; } // off-screen at current zoom
      if (allLoaded) { img.remove(); this.tiles.delete(key); continue; }
      const scale = 2 ** (this.zoom - z);
      const size = TILE_SIZE * scale;
      const left = Number(img.dataset.x) * size - this.originX;
      const top = Number(img.dataset.y) * size - this.originY;
      if (left + size < -TILE_SIZE || left > this.width() + TILE_SIZE ||
          top + size < -TILE_SIZE || top > this.height() + TILE_SIZE || scale > 8 || scale < 1 / 8) {
        img.remove(); this.tiles.delete(key); continue;
      }
      img.style.zIndex = '0';
      img.style.width = img.style.height = `${size}px`;
      img.style.left = `${left}px`;
      img.style.top = `${top}px`;
    }

    // Soft cap on cached tile elements.
    if (this.tiles.size > MAX_TILE_CACHE) {
      for (const [key, img] of this.tiles) {
        if (this.tiles.size <= MAX_TILE_CACHE) break;
        if (!wanted.has(key)) { img.remove(); this.tiles.delete(key); }
      }
    }
  }

  /** Once the current zoom's visible tiles are all loaded, remove stale-zoom tiles. */
  pruneStaleTiles() {
    let allLoaded = true;
    for (const img of this.tiles.values()) {
      if (Number(img.dataset.z) === this.zoom && !(img.complete && img.naturalWidth)) { allLoaded = false; break; }
    }
    if (!allLoaded) return;
    for (const [key, img] of this.tiles) {
      if (Number(img.dataset.z) !== this.zoom) { img.remove(); this.tiles.delete(key); }
    }
  }

  /** Screen X for a world X, wrapped across the antimeridian to the copy nearest the viewport. */
  wrapScreenX(worldX) {
    const world = this.worldSize();
    const centerWorldX = this.originX + this.width() / 2;
    const k = Math.round((centerWorldX - worldX) / world);
    return worldX + k * world - this.originX;
  }

  renderMarkers() {
    const openPhotoId = this.popupEl ? this.popupEl.dataset.photoId : null;
    clear(this.markerLayer);
    this.popupEl = null;
    this.hoverPopupEl = null;

    const width = this.width(), height = this.height();
    const points = this.markers
      .map((marker) => {
        const p = project(marker.latitude, marker.longitude, this.zoom);
        return { marker, x: this.wrapScreenX(p.x), y: p.y - this.originY };
      })
      .filter((p) => p.x > -80 && p.x < width + 80 && p.y > -80 && p.y < height + 80);

    let reopen = null;
    for (const cluster of clusterPoints(points, CLUSTER_RADIUS)) {
      if (cluster.points.length === 1) {
        const { marker, x, y } = cluster.points[0];
        this.markerLayer.appendChild(this.buildMarker(marker, x, y));
        if (marker.id === openPhotoId) reopen = { marker, x, y };
      } else {
        this.markerLayer.appendChild(this.buildCluster(cluster));
      }
    }

    if (this.selfLocation) {
      const p = project(this.selfLocation[0], this.selfLocation[1], this.zoom);
      this.markerLayer.appendChild(el('div', {
        class: 'map-self-dot', title: 'Your location',
        style: `left:${this.wrapScreenX(p.x)}px;top:${p.y - this.originY}px`,
      }));
    }

    if (this.pickMarker) {
      const p = project(this.pickMarker[0], this.pickMarker[1], this.zoom);
      this.markerLayer.appendChild(el('div', {
        class: 'map-marker pick', title: 'Selected location',
        style: `left:${this.wrapScreenX(p.x)}px;top:${p.y - this.originY}px`,
      }));
    }

    if (reopen) this.showPopup(reopen.marker, reopen.x, reopen.y);
  }

  /** A single photo marker — a small framed thumbnail (falls back to a pin). */
  buildMarker(marker, x, y) {
    const thumb = marker.urls && (marker.urls.thumb || marker.urls.medium);
    const hoverHandlers = {
      onmouseenter: () => this.showHoverPopup(marker, x, y),
      onmouseleave: () => this.scheduleHoverClose(),
    };
    if (thumb) {
      return el('button', {
        type: 'button',
        class: 'map-photo-marker', style: `left:${x}px;top:${y}px`,
        title: marker.title, 'aria-label': `Photo: ${marker.title}`,
        onclick: (e) => { e.stopPropagation(); this.closeHoverPopup(); this.showPopup(marker, x, y); },
        ...hoverHandlers,
      }, el('img', { src: thumb, alt: '', draggable: false, loading: 'lazy' }));
    }
    return el('button', {
      type: 'button',
      class: 'map-marker', style: `left:${x}px;top:${y}px`, title: marker.title,
      'aria-label': `Photo: ${marker.title}`,
      onclick: (e) => { e.stopPropagation(); this.closeHoverPopup(); this.showPopup(marker, x, y); },
      ...hoverHandlers,
    });
  }

  /** A cluster bubble — thumbnail of the first photo + count badge.
   *  Click hands the photo list off to opts.onClusterClick (the page renders
   *  it in a side panel). Falls back to zoom-to-fit only if no handler is set. */
  buildCluster(cluster) {
    const { x, y } = cluster;
    const first = cluster.points[0].marker;
    const thumb = first.urls && (first.urls.thumb || first.urls.medium);
    const items = cluster.points.map((p) => p.marker);
    return el('button', {
      type: 'button',
      class: `map-photo-cluster${thumb ? '' : ' no-thumb'}`, style: `left:${x}px;top:${y}px`,
      title: `${items.length} photos — click to view the list`,
      'aria-label': `${items.length} photos here`,
      onclick: (e) => {
        e.stopPropagation();
        if (typeof this.opts.onClusterClick === 'function') {
          this.opts.onClusterClick(items);
          return;
        }
        const fitted = this.fitToMarkers(items, { maxZoom: Math.min(MAX_ZOOM, this.zoom + 4), padding: 80 });
        if (!fitted || this.zoom >= MAX_ZOOM) this.zoomAt(x, y, 1);
      },
    }, [
      thumb ? el('img', { src: thumb, alt: '', draggable: false, loading: 'lazy' }) : null,
      el('span', { class: 'count' }, String(items.length)),
    ]);
  }

  showPopup(photo, x, y) {
    this.closePopup();
    const img = photo.urls && (photo.urls.medium || photo.urls.thumb);
    const popup = el('div', { class: 'map-popup', style: `left:${x}px;top:${y}px`, 'data-photo-id': photo.id }, [
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); this.closePopup(); } }, '✕'),
      img ? el('img', { src: img, alt: photo.title }) : null,
      el('div', { class: 'title' }, photo.title),
      el('div', { class: 'sub' }, `by ${photo.ownerEmail || photo.ownerUsername || 'unknown'}`),
      photo.capturedAt ? el('div', { class: 'sub' }, `Taken ${new Date(photo.capturedAt).toLocaleDateString()}`) : null,
      el('div', { class: 'sub' }, `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`),
      el('div', { class: 'sub' }, `Uploaded ${new Date(photo.createdAt).toLocaleDateString()}`),
      this.opts.popupActions ? this.opts.popupActions(photo) : null,
    ]);
    popup.addEventListener('click', (e) => e.stopPropagation());
    this.markerLayer.appendChild(popup);
    this.popupEl = popup;
  }

  closePopup() {
    if (this.popupEl) { this.popupEl.remove(); this.popupEl = null; }
  }

  /** Cancel a queued hover close — used when the cursor moves from the marker
   *  onto the popup itself, so the user can actually click its action button. */
  clearHoverCloseTimer() {
    if (this.hoverCloseTimer) { clearTimeout(this.hoverCloseTimer); this.hoverCloseTimer = null; }
  }

  /** Queue a close after a short grace period so the cursor can travel from
   *  the marker to the popup without it disappearing under it. */
  scheduleHoverClose() {
    this.clearHoverCloseTimer();
    this.hoverCloseTimer = setTimeout(() => this.closeHoverPopup(), 160);
  }

  /** Lightweight tooltip-style preview shown while hovering a marker.
   *  Optionally shows a single shortcut button via opts.hoverShortcut(photo). */
  showHoverPopup(photo, x, y) {
    this.clearHoverCloseTimer();
    if (this.popupEl && this.popupEl.dataset.photoId === photo.id) return;
    if (this.hoverPopupEl && this.hoverPopupEl.dataset.photoId === photo.id) return;
    this.closeHoverPopup();
    const img = photo.urls && (photo.urls.medium || photo.urls.thumb);
    const shortcut = typeof this.opts.hoverShortcut === 'function' ? this.opts.hoverShortcut(photo) : null;
    const popup = el('div', {
      class: 'map-popup map-popup-hover', style: `left:${x}px;top:${y}px`,
      'data-photo-id': photo.id,
      onmouseenter: () => this.clearHoverCloseTimer(),
      onmouseleave: () => this.scheduleHoverClose(),
      // The map widget grabs pointer capture on pointerdown to handle panning,
      // which would otherwise swallow click events that originate inside this
      // popup. Stop both events from reaching the viewport so its capture
      // logic never engages for clicks on the shortcut button.
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => e.stopPropagation(),
    }, [
      img ? el('img', { src: img, alt: photo.title }) : null,
      el('div', { class: 'title' }, photo.title || 'Untitled'),
      el('div', { class: 'sub' }, `by ${photo.ownerEmail || photo.ownerUsername || 'unknown'}`),
      photo.description ? el('div', { class: 'sub desc' }, photo.description) : null,
      photo.capturedAt ? el('div', { class: 'sub' }, `Taken ${new Date(photo.capturedAt).toLocaleDateString()}`) : null,
      photo.createdAt ? el('div', { class: 'sub' }, `Uploaded ${new Date(photo.createdAt).toLocaleDateString()}`) : null,
      shortcut ? el('div', { class: 'mt-1' }, shortcut) : null,
    ]);
    this.markerLayer.appendChild(popup);
    this.hoverPopupEl = popup;
  }

  closeHoverPopup() {
    if (this.hoverPopupEl) { this.hoverPopupEl.remove(); this.hoverPopupEl = null; }
  }

  /* A simple metric scale bar (standard slippy-map furniture). */
  renderScale() {
    if (!this.scaleBar) return;
    const { lat } = this.centerLatLng();
    const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** this.zoom;
    const target = metersPerPx * 90; // aim for ~90px wide
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000];
    let nice = steps[0];
    for (const s of steps) { if (s <= target) nice = s; else break; }
    const px = nice / metersPerPx;
    const label = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    this.scaleBar.firstChild.textContent = label;
    this.scaleBar.style.width = `${Math.round(px)}px`;
  }
}
