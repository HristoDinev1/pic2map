import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';
import { photoCard } from '../components/photo-card.js';

export function renderSearchPage(node) {
  const fields = {
    username: el('input', { placeholder: 'Username or email' }),
    album: el('input', { placeholder: 'Album' }),
    title: el('input', { placeholder: 'Photo title' }),
    dateFrom: el('input', { type: 'date' }),
    dateTo: el('input', { type: 'date' }),
  };
  const grid = el('div', { class: 'photo-grid' });
  const emptyMsg = el('p', { class: 'muted' }, 'No results.');
  emptyMsg.style.display = 'none';

  const run = async () => {
    const params = new URLSearchParams();
    for (const [key, input] of Object.entries(fields)) {
      if (input.value) params.set(key, input.value);
    }
    const r = await api.get(`/search?${params.toString()}`);
    clear(grid);
    emptyMsg.style.display = r.photos.length ? 'none' : '';
    for (const photo of r.photos) grid.appendChild(photoCard(photo));
  };

  mount(node, [
    el('h1', {}, 'Search'),
    el('div', { class: 'search-grid' }, Object.values(fields)),
    el('button', { class: 'btn btn-primary mb-3', onclick: run }, 'Search'),
    el('p', { class: 'muted', style: 'font-size:0.75rem' },
      'GPS-area search is also supported via the map bounding box (minLat/minLng/maxLat/maxLng).'),
    grid,
    emptyMsg,
  ]);
}
