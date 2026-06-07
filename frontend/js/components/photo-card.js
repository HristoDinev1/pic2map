import { el } from '../dom.js';

/** Renders a single photo tile — port of components/PhotoCard.tsx. */
export function photoCard(photo, onClick) {
  const img = photo.urls.thumb || photo.urls.medium || photo.urls.original;
  return el('button', { class: 'photo-card', onclick: onClick }, [
    el('div', { class: 'photo-thumb' },
      img
        ? el('img', { src: img, alt: photo.title, loading: 'lazy' })
        : el('div', { class: 'placeholder' }, photo.processState === 'READY' ? 'no preview' : photo.processState)
    ),
    el('div', { class: 'photo-meta' }, [
      el('div', { class: 'photo-title' }, photo.title),
      el('div', { class: 'photo-sub' }, [
        el('span', {}, photo.visibility === 'PUBLIC' ? '🌍 Public' : '🔒 Private'),
        photo.latitude != null ? el('span', {}, '📍') : null,
      ]),
    ]),
  ]);
}
