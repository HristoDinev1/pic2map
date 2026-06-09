import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';
import { photoCard } from '../components/photo-card.js';
import { openPhotoEditor } from '../components/photo-editor.js';

// Personal gallery: live title search + visibility/geotag filters + sorting,
// a small stats line, JSON/CSV export, and auto-refresh while any photo is
// still being processed by the Lambda.

const REFRESH_WHILE_PROCESSING_MS = 5000;

export function renderGalleryPage(node) {
  let photos = [];
  let disposed = false;
  let refreshTimer = null;
  window.addEventListener('pic2map:navigated', () => {
    disposed = true;
    if (refreshTimer) clearTimeout(refreshTimer);
  }, { once: true });

  const grid = el('div', { class: 'photo-grid' });
  const empty = el('p', { class: 'muted' }, 'No photos yet — upload some!');
  const noMatch = el('p', { class: 'muted' }, 'No photos match the current filters.');
  const statsLine = el('p', { class: 'muted', style: 'font-size:0.8125rem' }, 'Loading…');
  const errorLine = el('p', { class: 'error', style: 'display:none' });
  empty.style.display = 'none';
  noMatch.style.display = 'none';

  const searchInput = el('input', { type: 'search', placeholder: 'Search titles…', 'aria-label': 'Search titles', oninput: rerender });
  const filterSelect = el('select', { 'aria-label': 'Filter', onchange: rerender }, [
    el('option', { value: 'all' }, 'All photos'),
    el('option', { value: 'public' }, '🌍 Public'),
    el('option', { value: 'private' }, '🔒 Private'),
    el('option', { value: 'geotagged' }, '📍 Geotagged'),
    el('option', { value: 'nogps' }, 'No GPS'),
    el('option', { value: 'processing' }, 'Processing'),
  ]);
  const sortSelect = el('select', { 'aria-label': 'Sort', onchange: rerender }, [
    el('option', { value: 'newest' }, 'Newest first'),
    el('option', { value: 'oldest' }, 'Oldest first'),
    el('option', { value: 'title' }, 'Title A–Z'),
  ]);

  function visiblePhotos() {
    const q = searchInput.value.trim().toLowerCase();
    const f = filterSelect.value;
    let list = photos.filter((p) => {
      if (q && !(p.title || '').toLowerCase().includes(q)) return false;
      if (f === 'public' && p.visibility !== 'PUBLIC') return false;
      if (f === 'private' && p.visibility !== 'PRIVATE') return false;
      if (f === 'geotagged' && p.latitude == null) return false;
      if (f === 'nogps' && p.latitude != null) return false;
      if (f === 'processing' && p.processState === 'READY') return false;
      return true;
    });
    const s = sortSelect.value;
    list = list.slice().sort((a, b) => {
      if (s === 'title') return (a.title || '').localeCompare(b.title || '');
      const d = new Date(a.createdAt) - new Date(b.createdAt);
      return s === 'oldest' ? d : -d;
    });
    return list;
  }

  function rerender() {
    clear(grid);
    const list = visiblePhotos();
    empty.style.display = photos.length ? 'none' : '';
    noMatch.style.display = photos.length && !list.length ? '' : 'none';
    for (const photo of list) {
      grid.appendChild(photoCard(photo, () => openPhotoEditor(photo, load)));
    }
    const geo = photos.filter((p) => p.latitude != null).length;
    const pub = photos.filter((p) => p.visibility === 'PUBLIC').length;
    const processing = photos.filter((p) => p.processState !== 'READY' && p.processState !== 'ERROR').length;
    statsLine.textContent = photos.length
      ? `${photos.length} photos · ${geo} geotagged · ${pub} public` + (processing ? ` · ${processing} still processing…` : '')
      : '';
  }

  function load() {
    return api.get('/photos')
      .then((r) => {
        photos = r.photos;
        errorLine.style.display = 'none';
        rerender();
        // While the Lambda is still working on anything, refresh automatically
        // so thumbnails/GPS appear without the user mashing F5.
        const processing = photos.some((p) => p.processState !== 'READY' && p.processState !== 'ERROR');
        if (refreshTimer) clearTimeout(refreshTimer);
        if (processing && !disposed) refreshTimer = setTimeout(load, REFRESH_WHILE_PROCESSING_MS);
      })
      .catch((e) => { errorLine.textContent = e.message; errorLine.style.display = ''; statsLine.textContent = ''; });
  }

  const download = async (kind) => {
    try {
      const res = await fetch(`${api.base}/transfer/export.${kind}`, { headers: await api.authHeader() });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `pic2map-export.${kind}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { errorLine.textContent = e.message; errorLine.style.display = ''; }
  };

  mount(node, [
    el('div', { class: 'row-between mb-2', style: 'flex-wrap:wrap;gap:0.5rem' }, [
      el('h1', { style: 'margin:0' }, 'My gallery'),
      el('div', { class: 'row', style: 'font-size:0.875rem' }, [
        el('button', { class: 'btn-text', onclick: () => download('json') }, 'Export JSON'),
        el('button', { class: 'btn-text', onclick: () => download('csv') }, 'Export CSV'),
      ]),
    ]),
    el('div', { class: 'row mb-2', style: 'flex-wrap:wrap' }, [searchInput, filterSelect, sortSelect]),
    errorLine,
    statsLine,
    grid,
    empty,
    noMatch,
  ]);

  load();
}
