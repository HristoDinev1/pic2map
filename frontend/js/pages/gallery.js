import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';
import { photoCard } from '../components/photo-card.js';
import { openPhotoEditor } from '../components/photo-editor.js';

export function renderGalleryPage(node) {
  const grid = el('div', { class: 'photo-grid' });
  const empty = el('p', { class: 'muted' }, 'No photos yet — upload some!');
  empty.style.display = 'none';

  const load = () => api.get('/photos').then((r) => {
    clear(grid);
    empty.style.display = r.photos.length ? 'none' : '';
    for (const photo of r.photos) {
      grid.appendChild(photoCard(photo, () => openPhotoEditor(photo, load)));
    }
  });

  const download = async (kind) => {
    const res = await fetch(`${api.base}/transfer/export.${kind}`, { headers: await api.authHeader() });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pic2map-export.${kind}`; a.click();
    URL.revokeObjectURL(url);
  };

  mount(node, [
    el('div', { class: 'row-between mb-2' }, [
      el('h1', { style: 'margin:0' }, 'My gallery'),
      el('div', { class: 'row', style: 'font-size:0.875rem' }, [
        el('button', { class: 'btn-text', onclick: () => download('json') }, 'Export JSON'),
        el('button', { class: 'btn-text', onclick: () => download('csv') }, 'Export CSV'),
      ]),
    ]),
    grid,
    empty,
  ]);

  load();
}
