import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';

export function renderModerationPage(node) {
  const grid = el('div', { class: 'photo-grid' });
  const empty = el('p', { class: 'muted' }, 'Nothing pending review.');
  empty.style.display = 'none';

  const load = () => api.get('/moderation/queue').then((r) => {
    clear(grid);
    empty.style.display = r.photos.length ? 'none' : '';
    for (const photo of r.photos) {
      const act = (action) => async () => { await api.post(`/moderation/photos/${photo.id}`, { action }); load(); };
      grid.appendChild(el('div', { class: 'card', style: 'padding:0;overflow:hidden' }, [
        photo.urls.medium ? el('img', { src: photo.urls.medium, style: 'width:100%;height:9rem;object-fit:cover;display:block' }) : null,
        el('div', { style: 'padding:0.5rem' }, [
          el('div', { class: 'photo-title' }, photo.title),
          el('div', { class: 'muted', style: 'font-size:0.75rem' }, `by ${photo.ownerUsername}`),
          el('div', { class: 'row mt-1' }, [
            el('button', { class: 'btn btn-success btn-sm', onclick: act('APPROVE') }, 'Approve'),
            el('button', { class: 'btn btn-amber btn-sm', onclick: act('REJECT') }, 'Reject'),
            el('button', { class: 'btn btn-danger btn-sm', onclick: act('DELETE') }, 'Delete'),
          ]),
        ]),
      ]));
    }
  });

  mount(node, [el('h1', {}, 'Moderation queue'), empty, grid]);
  load();
}
