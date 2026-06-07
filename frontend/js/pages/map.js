import { el, mount } from '../dom.js';
import { api } from '../api.js';
import { CustomMap } from '../map/custom-map.js';

export function renderMapPage(node) {
  const status = el('p', {});
  const countLine = el('p', { class: 'muted mt-1' }, '');
  const mapWrap = el('div', { class: 'map-wrap' });

  mount(node, [
    el('h1', {}, 'Map'),
    status,
    mapWrap,
    countLine,
  ]);

  const map = new CustomMap(mapWrap, { center: [42.6977, 23.3219], zoom: 4 });

  api.get('/map/photos')
    .then((r) => {
      const geotagged = r.photos.filter((p) => p.latitude != null && p.longitude != null);
      map.setMarkers(geotagged);
      countLine.textContent = `${geotagged.length} geotagged photos shown.`;
    })
    .catch((e) => { status.textContent = e.message; status.className = 'error'; });
}
