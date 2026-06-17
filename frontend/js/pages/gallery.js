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
    const processing = photos.filter((p) => p.processState !== 'READY' && p.processState !== 'FAILED').length;
    statsLine.textContent = photos.length
      ? `${photos.length} photos · ${geo} geotagged · ${pub} public` + (processing ? ` · ${processing} still processing…` : '')
      : '';
  }

  let pendingDeepLink = readPhotoQueryParam();

  function maybeOpenDeepLink() {
    if (!pendingDeepLink) return;
    const target = photos.find((p) => String(p.id) === String(pendingDeepLink));
    if (!target) return;
    pendingDeepLink = null;
    // Strip the ?photo=… so a later refresh doesn't re-open the editor.
    history.replaceState(null, '', '#/gallery');
    openPhotoEditor(target, load);
  }

  function load() {
    return api.get('/photos')
      .then((r) => {
        photos = r.photos;
        errorLine.style.display = 'none';
        rerender();
        maybeOpenDeepLink();
        // While the Lambda is still working on anything, refresh automatically
        // so thumbnails/GPS appear without the user mashing F5.
        const processing = photos.some((p) => p.processState !== 'READY' && p.processState !== 'FAILED');
        if (refreshTimer) clearTimeout(refreshTimer);
        if (processing && !disposed) refreshTimer = setTimeout(load, REFRESH_WHILE_PROCESSING_MS);
      })
      .catch((e) => { errorLine.textContent = e.message; errorLine.style.display = ''; statsLine.textContent = ''; });
  }

  function readPhotoQueryParam() {
    const m = location.hash.match(/[?&]photo=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function openExportDialog() {
    const fromInput = el('input', { type: 'date', 'aria-label': 'From date' });
    const toInput = el('input', { type: 'date', 'aria-label': 'To date' });
    const visSelect = el('select', { 'aria-label': 'Visibility' }, [
      el('option', { value: '' }, 'All visibilities'),
      el('option', { value: 'PUBLIC' }, '🌍 Public only'),
      el('option', { value: 'PRIVATE' }, '🔒 Private only'),
    ]);
    const geoSelect = el('select', { 'aria-label': 'GPS' }, [
      el('option', { value: '' }, 'GPS: any'),
      el('option', { value: 'yes' }, '📍 Geotagged only'),
      el('option', { value: 'no' }, 'No GPS only'),
    ]);
    const urlsCheckbox = el('input', { type: 'checkbox', id: 'gallery-export-urls' });
    const urlsLabel = el('label', {
      for: 'gallery-export-urls',
      style: 'display:inline-flex;align-items:center;gap:0.4rem;font-size:0.875rem;cursor:pointer',
    }, [urlsCheckbox, 'Include time-limited image URL']);
    const note = el('p', { class: 'muted', style: 'font-size:0.8125rem;margin:0' },
      'Date range filters by capture date (or upload date when EXIF is missing). Leave any field empty to skip that filter.');

    const errBox = el('p', { class: 'error', style: 'display:none;margin:0' });

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    async function go(kind) {
      const params = new URLSearchParams();
      if (fromInput.value)  params.set('from', fromInput.value);
      if (toInput.value)    params.set('to', toInput.value);
      if (visSelect.value)  params.set('visibility', visSelect.value);
      if (geoSelect.value)  params.set('geo', geoSelect.value);
      if (urlsCheckbox.checked) params.set('urls', '1');
      const qs = params.toString();
      try {
        const res = await fetch(`${api.base}/transfer/export.${kind}${qs ? '?' + qs : ''}`, {
          headers: await api.authHeader(),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Export failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `pic2map-export.${kind}`; a.click();
        URL.revokeObjectURL(url);
        close();
      } catch (e) { errBox.textContent = e.message; errBox.style.display = ''; }
    }

    const overlay = el('div', { class: 'modal-overlay', onclick: close });
    const modal = el('div', { class: 'modal', onclick: (e) => e.stopPropagation() }, [
      el('div', { class: 'row-between' }, [
        el('h2', { style: 'margin:0' }, 'Export photos'),
        el('button', { class: 'btn-text', type: 'button', onclick: close, 'aria-label': 'Close' }, '✕'),
      ]),
      note,
      el('div', { class: 'row', style: 'gap:0.5rem' }, [
        el('label', { style: 'flex:1;display:flex;flex-direction:column;gap:0.2rem;font-size:0.75rem;color:var(--text-subtle);font-weight:600;letter-spacing:0.05em;text-transform:uppercase' }, ['FROM', fromInput]),
        el('label', { style: 'flex:1;display:flex;flex-direction:column;gap:0.2rem;font-size:0.75rem;color:var(--text-subtle);font-weight:600;letter-spacing:0.05em;text-transform:uppercase' }, ['TO', toInput]),
      ]),
      el('div', { class: 'row', style: 'gap:0.5rem;flex-wrap:wrap' }, [visSelect, geoSelect]),
      urlsLabel,
      errBox,
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:0.4rem;flex-wrap:wrap' }, [
        el('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
        el('button', { class: 'btn', type: 'button', onclick: () => go('csv') }, 'Export CSV'),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('json') }, 'Export JSON'),
      ]),
    ]);
    overlay.append(modal);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    fromInput.focus();
  }

  mount(node, [
    el('div', { class: 'row-between mb-2', style: 'flex-wrap:wrap;gap:0.5rem' }, [
      el('h1', { style: 'margin:0' }, 'My gallery'),
      el('div', { class: 'row', style: 'gap:0.5rem' }, [
        el('button', { class: 'btn btn-sm', onclick: openExportDialog }, 'Export'),
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
