import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';
import { photoCard } from '../components/photo-card.js';

export function renderAlbumDetailPage(node, params) {
  const id = params.id;
  const titleEl = el('h1', { style: 'margin:0' }, '');
  const descEl = el('p', { class: 'muted mb-3' }, '');
  const errorLine = el('p', { class: 'error', style: 'display:none' });
  const inAlbumGrid = el('div', { class: 'photo-grid mb-3' });
  const availableGrid = el('div', { class: 'photo-grid' });

  const downloadBtn = el('button', {
    class: 'btn btn-sm',
    title: 'Download every photo in this album as a ZIP',
    onclick: () => downloadZip(),
  }, 'Download .zip');
  downloadBtn.disabled = true; // re-enabled once we know the album has photos

  async function downloadZip() {
    errorLine.style.display = 'none';
    const original = downloadBtn.textContent;
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Preparing…';
    try {
      const res = await fetch(`${api.base}/albums/${id}/download`, { headers: await api.authHeader() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const filename = parseDispositionFilename(res.headers.get('Content-Disposition')) || `${(titleEl.textContent || 'album')}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      errorLine.textContent = e.message;
      errorLine.style.display = '';
    } finally {
      downloadBtn.textContent = original;
      downloadBtn.disabled = false;
    }
  }

  mount(node, [
    el('div', { class: 'row-between mb-1', style: 'flex-wrap:wrap;gap:0.5rem' }, [
      titleEl,
      downloadBtn,
    ]),
    descEl,
    errorLine,
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
      downloadBtn.disabled = r.photos.length === 0;

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

function parseDispositionFilename(header) {
  if (!header) return null;
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(header);
  return m ? decodeURIComponent(m[1]) : null;
}
