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
          setMsg('Location picked — click "Set / update" to save.');
        },
      });
      if (hasGps) picker.setPickMarker(photo.latitude, photo.longitude);
    }
  }

  // ---- Actions -------------------------------------------------------------
  async function saveMeta() {
    try {
      await api.patch(`/photos/${photo.id}`, {
        title: titleInput.value,
        description: descInput.value,
        visibility: visibilitySelect.value,
      });
      setMsg('Saved'); onChange();
    } catch (e) { setMsg(e.message, true); }
  }

  async function saveGps(clearGps) {
    try {
      let body;
      if (clearGps) {
        body = { latitude: null, longitude: null };
      } else {
        const latitude = Number(latInput.value);
        const longitude = Number(lngInput.value);
        if (latInput.value.trim() === '' || lngInput.value.trim() === '' || !isFinite(latitude) || !isFinite(longitude)) {
          setMsg('Enter numeric latitude and longitude (or pick on the map).', true);
          return;
        }
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          setMsg('Latitude must be −90…90 and longitude −180…180.', true);
          return;
        }
        body = { latitude, longitude };
      }
      await api.put(`/photos/${photo.id}/gps`, body);
      if (clearGps) { latInput.value = ''; lngInput.value = ''; if (picker) picker.setPickMarker(null, null); }
      setMsg(clearGps ? 'GPS removed' : 'GPS updated — the photo is now on the map');
      onChange();
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

  async function exportSingle(kind, withUrl) {
    try {
      const params = new URLSearchParams({ ids: photo.id });
      if (withUrl) params.set('urls', '1');
      const res = await fetch(`${api.base}/transfer/export.${kind}?${params.toString()}`, {
        headers: await api.authHeader(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const safe = (photo.title || 'photo').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'photo';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safe}.${kind}`; a.click();
      URL.revokeObjectURL(url);
      setMsg(`Exported as ${kind.toUpperCase()}`);
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
      ? el('img', { class: 'preview', src: photo.urls.medium || photo.urls.thumb, alt: photo.title })
      : null,
    titleInput,
    descInput,
    visibilitySelect,
    el('button', { class: 'btn btn-primary', onclick: saveMeta }, 'Save details'),
    el('div', { class: 'section' }, [
      el('div', { class: 'row-between' }, [
        el('p', { style: 'font-weight:500;font-size:0.875rem;margin:0' }, 'GPS coordinates'),
        pickerToggle,
      ]),
      el('div', { class: 'row mt-1' }, [latInput, lngInput]),
      pickerWrap,
      el('div', { class: 'row mt-1' }, [
        el('button', { class: 'btn btn-success', onclick: () => saveGps(false) }, 'Set / update'),
        el('button', { class: 'btn', onclick: () => saveGps(true) }, 'Remove'),
      ]),
    ]),
    el('div', { class: 'section' }, [
      el('p', { style: 'font-weight:500;font-size:0.875rem;margin:0 0 0.4rem' }, 'Export this photo'),
      el('div', { class: 'row', style: 'flex-wrap:wrap;gap:0.4rem' }, [
        el('button', { class: 'btn btn-sm', type: 'button', onclick: () => exportSingle('json', false) }, 'JSON'),
        el('button', { class: 'btn btn-sm', type: 'button', onclick: () => exportSingle('csv', false) }, 'CSV'),
        el('button', { class: 'btn btn-sm', type: 'button', title: 'Include a time-limited download URL', onclick: () => exportSingle('json', true) }, 'JSON + URL'),
        el('button', { class: 'btn btn-sm', type: 'button', title: 'Include a time-limited download URL', onclick: () => exportSingle('csv', true) }, 'CSV + URL'),
      ]),
    ]),
    el('div', { class: 'row-between section' }, [
      el('button', { class: 'btn-text-danger', onclick: remove }, 'Delete photo'),
      el('span', {}, [msgSpan, errSpan]),
    ])
  );

  document.body.appendChild(overlay);
  titleInput.focus();
}
