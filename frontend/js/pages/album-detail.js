import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';
import { photoCard } from '../components/photo-card.js';

export function renderAlbumDetailPage(node, params) {
  const id = params.id;
  const titleEl = el('h1', { class: 'mb-1' }, '');
  const descEl = el('p', { class: 'muted mb-3' }, '');
  const inAlbumGrid = el('div', { class: 'photo-grid mb-3' });
  const availableGrid = el('div', { class: 'photo-grid' });

  mount(node, [
    titleEl,
    descEl,
    el('h2', {}, 'In this album'),
    inAlbumGrid,
    el('h2', {}, 'Add from your gallery'),
    availableGrid,
  ]);

  const load = () => {
    api.get(`/albums/${id}`).then((r) => {
      titleEl.textContent = r.album.name;
      descEl.textContent = r.album.description || '';
      const inAlbumIds = new Set(r.photos.map((p) => p.id));

      clear(inAlbumGrid);
      for (const photo of r.photos) {
        inAlbumGrid.appendChild(el('div', {}, [
          photoCard(photo),
          el('button', {
            class: 'btn-text-danger mt-1', style: 'font-size:0.75rem',
            onclick: async () => { await api.del(`/albums/${id}/photos/${photo.id}`); load(); },
          }, 'Remove'),
        ]));
      }

      api.get('/photos').then((mineRes) => {
        clear(availableGrid);
        for (const photo of mineRes.photos.filter((p) => !inAlbumIds.has(p.id))) {
          availableGrid.appendChild(el('div', {}, [
            photoCard(photo),
            el('button', {
              class: 'btn-text mt-1', style: 'font-size:0.75rem',
              onclick: async () => { await api.post(`/albums/${id}/photos`, { photoId: photo.id }); load(); },
            }, '+ Add'),
          ]));
        }
      });
    });
  };

  load();
}
