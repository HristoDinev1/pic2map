import { el } from '../dom.js';

/** Renders a single photo tile — port of components/PhotoCard.tsx. */
export function photoCard(photo, onClick) {
  const img = photo.urls.thumb || photo.urls.medium || photo.urls.original;
  const processing = photo.processState !== 'READY' && photo.processState !== 'ERROR';
  const failed = photo.processState === 'ERROR';
  return el('button', { class: 'photo-card', onclick: onClick }, [
    el('div', { class: 'photo-thumb' }, [
      img
        ? el('img', { src: img, alt: photo.title, loading: 'lazy' })
        : el('div', { class: 'placeholder' }, processing ? 'processing…' : failed ? 'processing failed' : 'no preview'),
      processing ? el('span', { class: 'badge badge-busy thumb-badge' }, 'processing') : null,
      failed ? el('span', { class: 'badge badge-err thumb-badge' }, 'error') : null,
    ]),
    el('div', { class: 'photo-meta' }, [
      el('div', { class: 'photo-title' }, photo.title),
      el('div', { class: 'photo-sub' }, [
        el('span', {}, photo.visibility === 'PUBLIC' ? '🌍 Public' : '🔒 Private'),
        photo.latitude != null ? el('span', { title: 'Geotagged — visible on the map' }, '📍') : null,
      ]),
    ]),
  ]);
}
