import { el, mount, clear } from '../dom.js';
import { api, uploadPhoto } from '../api.js';
import { readExifGps } from '../exif.js';
import { navigate } from '../router.js';

// Upload page: drag-and-drop (or browse) → per-file preview cards with an
// editable title, a client-side GPS check (hand-written EXIF reader), a live
// progress bar during the S3 PUT, and post-upload processing status polled
// from the API so thumbnails appear as soon as the Lambda is done.

const ACCEPTED = /^image\/(jpe?g|png|webp|tiff?|heic)$/i;
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 40; // ~2 minutes

export function renderUploadPage(node) {
  /** @type {Array<{file:File, title:string, gps:object|null, status:string, error?:string, photoId?:string, row:object}>} */
  const items = [];
  let busy = false;
  let disposed = false;
  window.addEventListener('pic2map:navigated', () => { disposed = true; }, { once: true });

  const list = el('div', { class: 'stack mt-2' });
  const summary = el('p', { class: 'muted mt-1', style: 'font-size:0.8125rem' }, '');
  const uploadBtn = el('button', { class: 'btn btn-primary', disabled: true, onclick: submit }, 'Upload');
  const clearBtn = el('button', { class: 'btn', disabled: true, onclick: clearPending }, 'Clear');

  const fileInput = el('input', {
    type: 'file', multiple: true, accept: 'image/*', style: 'display:none',
    onchange: (e) => { addFiles(e.target.files); e.target.value = ''; },
  });

  const dropzone = el('div', {
    class: 'dropzone', role: 'button', tabindex: '0',
    onclick: () => fileInput.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
    ondragover: (e) => { e.preventDefault(); dropzone.classList.add('over'); },
    ondragleave: () => dropzone.classList.remove('over'),
    ondrop: (e) => {
      e.preventDefault();
      dropzone.classList.remove('over');
      addFiles(e.dataTransfer && e.dataTransfer.files);
    },
  }, [
    el('div', { class: 'dz-icon' }, '🖼️'),
    el('div', { class: 'dz-title' }, 'Drag & drop photos here'),
    el('div', { class: 'dz-sub' }, 'or click to browse — JPEG, PNG, WebP, TIFF, HEIC'),
  ]);

  function pending() { return items.filter((it) => it.status === 'pending'); }

  function refreshControls() {
    const n = pending().length;
    uploadBtn.disabled = busy || n === 0;
    clearBtn.disabled = busy || n === 0;
    uploadBtn.textContent = busy ? 'Uploading…' : n > 1 ? `Upload ${n} photos` : 'Upload';
    const withGps = pending().filter((it) => it.gps).length;
    summary.textContent = n
      ? `${n} photo${n === 1 ? '' : 's'} ready — ${withGps} with GPS data (those will appear on the map automatically).`
      : '';
  }

  async function addFiles(fileList) {
    if (!fileList || !fileList.length) return;
    for (const file of Array.from(fileList)) {
      if (!ACCEPTED.test(file.type || '')) {
        list.appendChild(el('p', { class: 'error', style: 'font-size:0.8125rem;margin:0' },
          `Skipped "${file.name}" — not a supported image type.`));
        continue;
      }
      const item = {
        file,
        title: file.name.replace(/\.[^.]+$/, ''),
        gps: null,
        status: 'pending',
        row: null,
      };
      items.push(item);
      item.row = buildRow(item);
      list.appendChild(item.row.root);
      // Detect GPS without blocking the UI (submit awaits this promise so a
      // fast click can never race past the EXIF read).
      item.gpsPromise = readExifGps(file).then((gps) => {
        item.gps = gps;
        item.row.setGps(gps);
        refreshControls();
      }).catch(() => {});
    }
    refreshControls();
  }

  function buildRow(item) {
    const previewUrl = URL.createObjectURL(item.file);
    const titleInput = el('input', {
      value: item.title, placeholder: 'Title', 'aria-label': 'Photo title',
      oninput: (e) => { item.title = e.target.value; },
    });
    const gpsBadge = el('span', { class: 'badge' }, 'reading EXIF…');
    const statusEl = el('div', { class: 'upload-status muted' }, formatSize(item.file.size));
    const bar = el('div', { class: 'bar' });
    const progress = el('div', { class: 'progress', style: 'display:none' }, bar);
    const removeBtn = el('button', {
      class: 'btn-text-danger', type: 'button', 'aria-label': `Remove ${item.file.name}`,
      onclick: () => {
        if (item.status !== 'pending') return;
        items.splice(items.indexOf(item), 1);
        URL.revokeObjectURL(previewUrl);
        root.remove();
        refreshControls();
      },
    }, 'Remove');
    const actions = el('div', { class: 'row', style: 'margin-left:auto' }, removeBtn);

    const root = el('div', { class: 'upload-row card' }, [
      el('img', { class: 'upload-preview', src: previewUrl, alt: '' }),
      el('div', { class: 'upload-row-body' }, [
        el('div', { class: 'row' }, [titleInput, gpsBadge]),
        statusEl,
        progress,
      ]),
      actions,
    ]);

    return {
      root,
      setGps(gps) {
        gpsBadge.textContent = gps ? '📍 GPS found' : 'no GPS — set it later in the editor';
        gpsBadge.className = gps ? 'badge badge-ok' : 'badge';
        if (gps) gpsBadge.title = `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
      },
      setStatus(text, kind) {
        statusEl.textContent = text;
        statusEl.className = `upload-status ${kind || 'muted'}`;
      },
      setProgress(fraction) {
        progress.style.display = '';
        bar.style.width = `${Math.round(fraction * 100)}%`;
      },
      hideProgress() { progress.style.display = 'none'; },
      lock() { titleInput.disabled = true; removeBtn.style.display = 'none'; },
      showActions(nodes) { clear(actions); actions.append(...nodes); },
    };
  }

  function clearPending() {
    for (const it of pending()) it.row.root.remove();
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].status === 'pending') items.splice(i, 1);
    }
    refreshControls();
  }

  async function submit() {
    const batch = pending();
    if (!batch.length || busy) return;
    busy = true;
    refreshControls();

    for (const item of batch) {
      item.row.lock();
      item.row.setStatus('Uploading…');
      try {
        if (item.gpsPromise) await item.gpsPromise; // ensure EXIF GPS is known
        item.photoId = await uploadPhoto(item.file, item.title || item.file.name, (f) => item.row.setProgress(f));
        item.status = 'processing';
        item.row.hideProgress();
        // Geotag right away from the EXIF GPS we already read in the browser —
        // the photo appears on the map immediately instead of waiting on (or
        // depending on) the server-side Lambda to extract it.
        if (item.gps) {
          try {
            await api.put(`/photos/${item.photoId}/gps`, {
              latitude: item.gps.latitude,
              longitude: item.gps.longitude,
            });
            item.row.setStatus('Uploaded ✓ — 📍 on the map; building thumbnails…', 'success');
          } catch {
            // Non-fatal: the Lambda extracts GPS server-side as a fallback.
            item.row.setStatus('Uploaded ✓ — processing (EXIF + thumbnails)…', 'success');
          }
        } else {
          item.row.setStatus('Uploaded ✓ — processing (EXIF + thumbnails)…', 'success');
        }
        pollProcessing(item); // fire-and-forget; updates the row when ready
      } catch (e) {
        item.status = 'error';
        item.error = e.message;
        item.row.hideProgress();
        item.row.setStatus(`✗ ${e.message}`, 'error');
        item.row.showActions([
          el('button', { class: 'btn btn-sm', onclick: () => { item.status = 'pending'; item.row.setStatus('Ready to retry'); refreshControls(); } }, 'Retry'),
        ]);
      }
    }

    busy = false;
    refreshControls();
  }

  /** Poll GET /photos/:id until the Lambda marks it READY (or errors out). */
  async function pollProcessing(item) {
    for (let attempt = 0; attempt < POLL_MAX_TRIES && !disposed; attempt++) {
      try {
        const { photo } = await api.get(`/photos/${item.photoId}`);
        if (photo.processState === 'READY') {
          item.status = 'done';
          const onMap = photo.latitude != null && photo.longitude != null;
          item.row.setStatus(onMap ? '✓ Ready — geotagged and on the map' : '✓ Ready — no GPS in the file (you can set it in the gallery)', 'success');
          item.row.showActions([
            onMap ? el('button', { class: 'btn btn-sm btn-primary', onclick: () => navigate('/') }, 'View on map') : null,
            el('button', { class: 'btn btn-sm', onclick: () => navigate('/gallery') }, 'Open gallery'),
          ].filter(Boolean));
          return;
        }
        if (photo.processState === 'ERROR') {
          item.status = 'error';
          item.row.setStatus(`✗ Processing failed${photo.processError ? `: ${photo.processError}` : ''}`, 'error');
          return;
        }
      } catch { /* transient — keep polling */ }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!disposed) item.row.setStatus('Still processing — it will show up in your gallery shortly.', 'muted');
  }

  mount(node, el('div', { style: 'max-width:42rem' }, [
    el('h1', {}, 'Upload photos'),
    el('p', { class: 'muted', style: 'font-size:0.8125rem;margin-top:0' },
      'Originals go straight to S3; a Lambda extracts GPS/EXIF and builds thumbnails. ' +
      'Photos with GPS data appear on the map automatically.'),
    fileInput,
    dropzone,
    summary,
    list,
    el('div', { class: 'row mt-2' }, [uploadBtn, clearBtn]),
  ]));
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
