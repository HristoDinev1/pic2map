import { el, mount } from '../dom.js';
import { api } from '../api.js';

/** Modal editor: title/visibility + GPS edit/clear + delete — port of components/PhotoEditor.tsx. */
export function openPhotoEditor(photo, onChange) {
  let msg = '';

  const titleInput = el('input', { value: photo.title, placeholder: 'Title' });
  const visibilitySelect = el('select', {}, [
    el('option', { value: 'PRIVATE', selected: photo.visibility === 'PRIVATE' }, 'Private'),
    el('option', { value: 'PUBLIC', selected: photo.visibility === 'PUBLIC' }, 'Public'),
  ]);
  visibilitySelect.value = photo.visibility;
  const latInput = el('input', { value: photo.latitude != null ? String(photo.latitude) : '', placeholder: 'latitude', style: 'width:50%' });
  const lngInput = el('input', { value: photo.longitude != null ? String(photo.longitude) : '', placeholder: 'longitude', style: 'width:50%' });
  const msgSpan = el('span', { class: 'success' }, '');

  const overlay = el('div', { class: 'modal-overlay', onclick: close });
  const modal = el('div', { class: 'modal', onclick: (e) => e.stopPropagation() });
  overlay.append(modal);

  function setMsg(text) { msgSpan.textContent = text; }

  async function saveMeta() {
    await api.patch(`/photos/${photo.id}`, { title: titleInput.value, visibility: visibilitySelect.value });
    setMsg('Saved'); onChange();
  }
  async function saveGps(clearGps) {
    await api.put(`/photos/${photo.id}/gps`, clearGps
      ? { latitude: null, longitude: null }
      : { latitude: Number(latInput.value), longitude: Number(lngInput.value) });
    setMsg(clearGps ? 'GPS removed' : 'GPS updated'); onChange();
  }
  async function remove() {
    if (!confirm('Delete this photo?')) return;
    await api.del(`/photos/${photo.id}`);
    onChange();
    close();
  }
  function close() { overlay.remove(); }

  modal.append(
    photo.urls.medium ? el('img', { class: 'preview', src: photo.urls.medium, alt: photo.title }) : null,
    titleInput,
    visibilitySelect,
    el('button', { class: 'btn btn-primary', onclick: saveMeta }, 'Save details'),
    el('div', { class: 'section' }, [
      el('p', { style: 'font-weight:500;font-size:0.875rem;margin:0 0 0.25rem' }, 'GPS coordinates'),
      el('div', { class: 'row' }, [latInput, lngInput]),
      el('div', { class: 'row mt-1' }, [
        el('button', { class: 'btn btn-success', onclick: () => saveGps(false) }, 'Set / update'),
        el('button', { class: 'btn', onclick: () => saveGps(true) }, 'Remove'),
      ]),
    ]),
    el('div', { class: 'row-between section' }, [
      el('button', { class: 'btn-text-danger', onclick: remove }, 'Delete photo'),
      msgSpan,
    ])
  );

  document.body.appendChild(overlay);
}
