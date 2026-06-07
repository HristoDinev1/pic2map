import { el, mount } from '../dom.js';
import { uploadPhoto } from '../api.js';

export function renderUploadPage(node) {
  let files = null;
  let busy = false;

  const log = el('ul', { class: 'mt-2', style: 'list-style:none;padding:0;font-size:0.875rem' });
  const button = el('button', { class: 'btn btn-primary', disabled: true, onclick: submit }, 'Upload');
  const input = el('input', {
    type: 'file', multiple: true, accept: 'image/*', class: 'mb-2',
    onchange: (e) => { files = e.target.files; button.disabled = busy || !files?.length; },
  });

  function addLog(text) { log.appendChild(el('li', {}, text)); }

  async function submit() {
    if (!files?.length) return;
    busy = true; button.disabled = true; button.textContent = 'Uploading…';
    while (log.firstChild) log.removeChild(log.firstChild);
    for (const file of Array.from(files)) {
      try {
        await uploadPhoto(file, file.name);
        addLog(`✓ ${file.name} uploaded — processing in the cloud…`);
      } catch (e) {
        addLog(`✗ ${file.name}: ${e.message}`);
      }
    }
    busy = false; button.disabled = !files?.length; button.textContent = 'Upload';
  }

  mount(node, el('div', { style: 'max-width:32rem' }, [
    el('h1', {}, 'Upload photos'),
    input,
    button,
    el('p', { class: 'muted mt-1', style: 'font-size:0.75rem' },
      'Originals go straight to S3. A Lambda then extracts GPS/EXIF and builds ' +
      'thumbnails — they appear in your gallery once processing finishes.'),
    log,
  ]));
}
