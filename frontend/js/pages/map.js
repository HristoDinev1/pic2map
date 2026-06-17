import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';
import { authStore } from '../auth-store.js';
import { navigate } from '../router.js';
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
  const clusterPanel = el('aside', { class: 'cluster-panel', 'aria-hidden': 'true' });
  const stage = el('div', { class: 'map-stage' }, [mapWrap, clusterPanel]);

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
    stage,
    el('p', { class: 'mt-1', style: 'font-size:0.8125rem' }, countLine),
  ]);

  function closeClusterPanel() {
    stage.classList.remove('split');
    clusterPanel.setAttribute('aria-hidden', 'true');
    clear(clusterPanel);
  }

  function buildPopupActions(photo) {
    // Defined as a standalone helper so both the in-map popup and the side
    // panel rows show the same Open / In gallery / Edit buttons.
    const me = authStore.profile && authStore.profile.email;
    const isMine = me && photo.ownerEmail === me;
    const buttons = [];
    const full = photo.urls && (photo.urls.large || photo.urls.original || photo.urls.medium);
    if (full) buttons.push(el('a', { class: 'btn btn-sm', href: full, target: '_blank', rel: 'noopener' }, 'Open'));
    if (isMine) {
      buttons.push(el('button', {
        class: 'btn btn-sm',
        title: 'Jump to this photo in your gallery',
        onclick: () => navigate(`/gallery?photo=${encodeURIComponent(photo.id)}`),
      }, 'In gallery'));
      buttons.push(el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: () => openPhotoEditor(photo, () => load()),
      }, 'Edit'));
    }
    return buttons.length ? el('div', { class: 'row mt-1', style: 'flex-wrap:wrap;gap:0.35rem' }, buttons) : null;
  }

  function openClusterPanel(photos) {
    clear(clusterPanel);
    clusterPanel.appendChild(el('div', { class: 'cluster-panel-head' }, [
      el('div', {}, [
        el('div', { class: 'cluster-panel-eyebrow' }, 'PHOTOS HERE'),
        el('div', { class: 'cluster-panel-title' }, `${photos.length} at this spot`),
      ]),
      el('button', {
        class: 'cluster-panel-close', type: 'button', 'aria-label': 'Close',
        onclick: closeClusterPanel,
      }, '✕'),
    ]));
    const list = el('div', { class: 'cluster-panel-list' });
    for (const photo of photos) {
      const thumb = photo.urls && (photo.urls.thumb || photo.urls.medium);
      list.appendChild(el('div', { class: 'cluster-panel-row' }, [
        thumb
          ? el('img', { class: 'cluster-panel-thumb', src: thumb, alt: '', loading: 'lazy' })
          : el('div', { class: 'cluster-panel-thumb cluster-panel-thumb-empty' }),
        el('div', { class: 'cluster-panel-body' }, [
          el('div', { class: 'cluster-panel-row-title', title: photo.title || 'Untitled' }, photo.title || 'Untitled'),
          el('div', { class: 'cluster-panel-row-sub' }, `by ${photo.ownerEmail || photo.ownerUsername || 'unknown'}`),
          photo.capturedAt
            ? el('div', { class: 'cluster-panel-row-sub' }, `Taken ${new Date(photo.capturedAt).toLocaleDateString()}`)
            : null,
          el('div', { class: 'cluster-panel-row-sub' },
            `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`),
          buildPopupActions(photo),
        ]),
      ]));
    }
    clusterPanel.appendChild(list);
    clusterPanel.setAttribute('aria-hidden', 'false');
    stage.classList.add('split');
  }

  // Close the panel when navigating away from the map page.
  window.addEventListener('pic2map:navigated', () => closeClusterPanel(), { once: true });

  function buildHoverShortcut(photo) {
    const me = authStore.profile && authStore.profile.email;
    if (!me || photo.ownerEmail !== me) return null;
    return el('button', {
      class: 'btn btn-sm btn-primary',
      type: 'button',
      title: 'Edit this photo',
      style: 'width:100%;justify-content:center',
      onclick: (e) => {
        e.stopPropagation();
        // Hover popup auto-closes when the cursor leaves; the editor modal
        // overlays the whole map so the cursor never reaches the popup.
        openPhotoEditor(photo, () => load());
      },
    }, 'Edit photo');
  }

  const map = new CustomMap(mapWrap, {
    center: [42.6977, 23.3219],
    zoom: 4,
    popupActions: buildPopupActions,
    onClusterClick: openClusterPanel,
    hoverShortcut: buildHoverShortcut,
  });

  function applyFilters() {
    const me = authStore.profile && authStore.profile.email;
    const who = ownerFilter.value;
    const q = titleFilter.value.trim().toLowerCase();
    const filtered = allPhotos.filter((p) => {
      if (who === 'mine' && p.ownerEmail !== me) return false;
      if (who === 'others' && p.ownerEmail === me) return false;
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
