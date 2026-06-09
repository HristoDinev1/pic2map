import { el, mount } from '../dom.js';
import { api } from '../api.js';
import { authStore } from '../auth-store.js';
import { CustomMap } from '../map/custom-map.js';
import { openPhotoEditor } from '../components/photo-editor.js';

// Map page: photo-thumbnail markers with clustering, a toolbar to filter
// (everyone / mine / others), live title search, refresh, and an auto
// fit-to-photos on first load. Your own photos can be edited straight from
// their popup.

export function renderMapPage(node) {
  let allPhotos = [];
  let firstLoad = true;

  const status = el('p', { class: 'error', style: 'display:none' });
  const countLine = el('span', { class: 'muted' }, 'Loading photos…');
  const mapWrap = el('div', { class: 'map-wrap' });

  const ownerFilter = el('select', { 'aria-label': 'Whose photos', onchange: applyFilters }, [
    el('option', { value: 'all' }, 'Everyone'),
    el('option', { value: 'mine' }, 'My photos'),
    el('option', { value: 'others' }, 'Others'),
  ]);
  const titleFilter = el('input', {
    type: 'search', placeholder: 'Filter by title…', 'aria-label': 'Filter by title',
    oninput: applyFilters,
  });
  const refreshBtn = el('button', { class: 'btn btn-sm', onclick: () => load() }, 'Refresh');
  const fitBtn = el('button', { class: 'btn btn-sm', onclick: () => map.fitToMarkers() }, 'Fit photos');

  mount(node, [
    el('div', { class: 'row-between mb-2', style: 'flex-wrap:wrap;gap:0.5rem' }, [
      el('h1', { style: 'margin:0' }, 'Map'),
      el('div', { class: 'row', style: 'flex-wrap:wrap' }, [ownerFilter, titleFilter, fitBtn, refreshBtn]),
    ]),
    status,
    mapWrap,
    el('p', { class: 'mt-1', style: 'font-size:0.8125rem' }, countLine),
  ]);

  const map = new CustomMap(mapWrap, {
    center: [42.6977, 23.3219],
    zoom: 4,
    popupActions: (photo) => {
      const me = authStore.profile && authStore.profile.username;
      const buttons = [];
      const full = photo.urls && (photo.urls.large || photo.urls.original || photo.urls.medium);
      if (full) {
        buttons.push(el('a', { class: 'btn btn-sm', href: full, target: '_blank', rel: 'noopener' }, 'Open'));
      }
      if (me && photo.ownerUsername === me) {
        buttons.push(el('button', {
          class: 'btn btn-sm btn-primary',
          onclick: () => openPhotoEditor(photo, () => load()),
        }, 'Edit'));
      }
      return buttons.length ? el('div', { class: 'row mt-1' }, buttons) : null;
    },
  });

  function applyFilters() {
    const me = authStore.profile && authStore.profile.username;
    const who = ownerFilter.value;
    const q = titleFilter.value.trim().toLowerCase();
    const filtered = allPhotos.filter((p) => {
      if (who === 'mine' && p.ownerUsername !== me) return false;
      if (who === 'others' && p.ownerUsername === me) return false;
      if (q && !(p.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
    map.setMarkers(filtered);
    countLine.textContent = filtered.length === allPhotos.length
      ? `${allPhotos.length} geotagged photo${allPhotos.length === 1 ? '' : 's'} on the map. Photos without GPS can be placed from the gallery editor.`
      : `Showing ${filtered.length} of ${allPhotos.length} geotagged photos.`;
  }

  function load() {
    status.style.display = 'none';
    return api.get('/map/photos')
      .then((r) => {
        allPhotos = r.photos.filter((p) => p.latitude != null && p.longitude != null);
        applyFilters();
        if (firstLoad && allPhotos.length) {
          map.fitToMarkers(allPhotos, { maxZoom: 12 });
          firstLoad = false;
        }
      })
      .catch((e) => {
        status.textContent = e.message;
        status.style.display = '';
        countLine.textContent = '';
      });
  }

  load();
}
