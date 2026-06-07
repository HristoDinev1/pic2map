import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';

export function renderAlbumsPage(node) {
  const grid = el('div', { class: 'photo-grid', style: 'grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))' });
  const empty = el('p', { class: 'muted' }, 'No albums yet.');
  empty.style.display = 'none';
  const nameInput = el('input', { placeholder: 'New album name', style: 'flex:1' });

  const load = () => api.get('/albums').then((r) => {
    clear(grid);
    empty.style.display = r.albums.length ? 'none' : '';
    for (const album of r.albums) {
      grid.appendChild(el('div', { class: 'card' }, [
        el('a', { href: `#/albums/${album.id}`, style: 'font-weight:500' }, album.name),
        el('div', { class: 'muted', style: 'font-size:0.75rem' }, `${album.photo_count ?? 0} photos · ${album.visibility}`),
        el('button', {
          class: 'btn-text-danger mt-1', style: 'font-size:0.75rem',
          onclick: async () => { if (confirm('Delete album?')) { await api.del(`/albums/${album.id}`); load(); } },
        }, 'Delete'),
      ]));
    }
  });

  const create = async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    await api.post('/albums', { name });
    nameInput.value = '';
    load();
  };

  mount(node, [
    el('h1', {}, 'Albums'),
    el('div', { class: 'row mb-3' }, [
      nameInput,
      el('button', { class: 'btn btn-primary', onclick: create }, 'Create'),
    ]),
    grid,
    empty,
  ]);

  load();
}
