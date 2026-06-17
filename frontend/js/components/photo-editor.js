import { el, mount } from '../dom.js';
import { api } from '../api.js';
import { CustomMap } from '../map/custom-map.js';

// Modal editor: title/description/visibility + GPS (typed coordinates OR a
// click-to-place mini map) + delete.

export function openPhotoEditor(photo, onChange) {
  const titleInput = el('input', { value: photo.title, placeholder: 'Title' });
  const descInput = el('textarea', {
    placeholder: 'Description (optional)', rows: '2',
  }, photo.description || '');
  const visibilitySelect = el('select', {}, [
    el('option', { value: 'PRIVATE', selected: photo.visibility === 'PRIVATE' }, '🔒 Private'),
    el('option', { value: 'PUBLIC', selected: photo.visibility === 'PUBLIC' }, '🌍 Public'),
  ]);
  visibilitySelect.value = photo.visibility;

  const latInput = el('input', { value: photo.latitude != null ? String(photo.latitude) : '', placeholder: 'latitude', style: 'width:50%', inputmode: 'decimal' });
  const lngInput = el('input', { value: photo.longitude != null ? String(photo.longitude) : '', placeholder: 'longitude', style: 'width:50%', inputmode: 'decimal' });
  const msgSpan = el('span', { class: 'success' }, '');
  const errSpan = el('span', { class: 'error' }, '');

  const overlay = el('div', { class: 'modal-overlay', onclick: close });
  const modal = el('div', { class: 'modal modal-wide', onclick: (e) => e.stopPropagation() });
  overlay.append(modal);

  function setMsg(text, isError) {
    msgSpan.textContent = isError ? '' : text;
    errSpan.textContent = isError ? text : '';
  }

  // ---- Mini map picker -----------------------------------------------------
  const pickerWrap = el('div', { class: 'map-wrap map-wrap-mini', style: 'display:none' });
  let picker = null;
  const pickerToggle = el('button', { class: 'btn btn-sm', type: 'button', onclick: togglePicker }, 'Pick on map');

  function togglePicker() {
    const showing = pickerWrap.style.display !== 'none';
    if (showing) {
      pickerWrap.style.display = 'none';
      pickerToggle.textContent = 'Pick on map';
      return;
    }
    pickerWrap.style.display = '';
    pickerToggle.textContent = 'Hide map';
    if (!picker) {
      const hasGps = photo.latitude != null && photo.longitude != null;
      picker = new CustomMap(pickerWrap, {
        center: hasGps ? [photo.latitude, photo.longitude] : [42.6977, 23.3219],
        zoom: hasGps ? 12 : 3,
        showFitControl: false,
        onPick: (lat, lng) => {
          latInput.value = lat.toFixed(6);
          lngInput.value = lng.toFixed(6);
          setMsg('Location picked — click "Save changes" to apply.');
        },
      });
      if (hasGps) picker.setPickMarker(photo.latitude, photo.longitude);
    }
  }

  // ---- Actions -------------------------------------------------------------
  /** Persists every change in one shot: title/description/visibility via PATCH,
   *  and the GPS coordinates via PUT (only when they actually changed — clears
   *  to null when both fields were emptied). */
  async function saveAll() {
    const origLat = photo.latitude != null ? String(photo.latitude) : '';
    const origLng = photo.longitude != null ? String(photo.longitude) : '';
    const latStr = latInput.value.trim();
    const lngStr = lngInput.value.trim();
    const gpsChanged = latStr !== origLat || lngStr !== origLng;

    let gpsBody = null;
    if (gpsChanged) {
      if (latStr === '' && lngStr === '') {
        gpsBody = { latitude: null, longitude: null };
      } else {
        const latitude = Number(latStr);
        const longitude = Number(lngStr);
        if (latStr === '' || lngStr === '' || !isFinite(latitude) || !isFinite(longitude)) {
          setMsg('Enter numeric latitude and longitude (or pick on the map), or clear both to remove GPS.', true);
          return;
        }
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          setMsg('Latitude must be −90…90 and longitude −180…180.', true);
          return;
        }
        gpsBody = { latitude, longitude };
      }
    }

    try {
      await api.patch(`/photos/${photo.id}`, {
        title: titleInput.value,
        description: descInput.value,
        visibility: visibilitySelect.value,
      });
      if (gpsBody) {
        await api.put(`/photos/${photo.id}/gps`, gpsBody);
        if (gpsBody.latitude === null && picker) picker.setPickMarker(null, null);
      }
      setMsg('Saved'); onChange();
    } catch (e) { setMsg(e.message, true); }
  }

  async function remove() {
    if (!confirm('Delete this photo? This cannot be undone.')) return;
    try {
      await api.del(`/photos/${photo.id}`);
      onChange();
      close();
    } catch (e) { setMsg(e.message, true); }
  }

  function close() {
    if (picker) picker.destroy();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);

  modal.append(
    el('div', { class: 'row-between' }, [
      el('h2', { style: 'margin:0' }, 'Edit photo'),
      el('button', { class: 'btn-text', type: 'button', onclick: close, 'aria-label': 'Close' }, '✕'),
    ]),
    photo.urls.medium || photo.urls.thumb
      ? el('img', {
          class: 'preview preview-zoomable',
          src: photo.urls.medium || photo.urls.thumb,
          alt: photo.title,
          title: 'Click to view full size',
          onclick: () => openLightbox(photo),
        })
      : null,
    titleInput,
    descInput,
    visibilitySelect,
    el('div', { class: 'section' }, [
      el('div', { class: 'row-between' }, [
        el('p', { style: 'font-weight:500;font-size:0.875rem;margin:0' }, 'GPS coordinates'),
        pickerToggle,
      ]),
      el('div', { class: 'row mt-1' }, [latInput, lngInput]),
      pickerWrap,
      el('p', { class: 'muted', style: 'font-size:0.75rem;margin:0.4rem 0 0' },
        'Clear both fields to remove GPS from this photo.'),
    ]),
    el('button', { class: 'btn btn-primary', style: 'width:100%', onclick: saveAll }, 'Save changes'),
    el('div', { class: 'row-between section' }, [
      el('button', { class: 'btn-text-danger', onclick: remove }, 'Delete photo'),
      el('span', {}, [msgSpan, errSpan]),
    ])
  );

  document.body.appendChild(overlay);
  titleInput.focus();
}

/** Fullscreen image viewer — click anywhere or hit Esc to dismiss. */
function openLightbox(photo) {
  const src =
    (photo.urls && (photo.urls.large || photo.urls.original || photo.urls.medium || photo.urls.thumb)) || null;
  if (!src) return;

  function close() {
    box.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  const img = el('img', { src, alt: photo.title || '', class: 'lightbox-img' });
  const box = el('div', {
    class: 'lightbox',
    role: 'dialog',
    'aria-label': 'Full-size photo',
    onclick: close,
  }, img);
  // Stop image clicks from closing instantly so users can right-click / drag /
  // pinch — the surrounding background still closes on click.
  img.addEventListener('click', (e) => e.stopPropagation());

  document.body.appendChild(box);
  document.addEventListener('keydown', onKey);
}
