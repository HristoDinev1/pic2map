// Theme & customization controller — independent of the rest of the app.
// Persists user choices in localStorage and applies them as data-* attributes
// on <html> so style.css can swap palettes without touching the DOM.

import { el, mount } from './dom.js';

const STORAGE_KEY = 'pic2map.theme.v1';

const DEFAULTS = {
  theme: 'light',          // light | dark | midnight
  accent: 'indigo',        // indigo | violet | rose | amber | emerald | sky | slate
  density: 'comfortable',  // comfortable | compact
  radius: 'default',       // sharp | default | soft
};

const ACCENTS = [
  { id: 'indigo',  color: '#4f46e5' },
  { id: 'violet',  color: '#8b5cf6' },
  { id: 'rose',    color: '#e11d48' },
  { id: 'amber',   color: '#d97706' },
  { id: 'emerald', color: '#059669' },
  { id: 'sky',     color: '#0284c7' },
  { id: 'slate',   color: '#334155' },
];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function apply(state) {
  const root = document.documentElement;
  root.setAttribute('data-theme', state.theme);
  root.setAttribute('data-accent', state.accent);
  root.setAttribute('data-density', state.density);
  root.setAttribute('data-radius', state.radius);
}

let state = load();
apply(state);

function setKey(key, value) {
  state = { ...state, [key]: value };
  apply(state);
  save(state);
}

function seg(label, key, options) {
  const wrap = el('div', { class: 'theme-row' }, [
    el('span', { class: 'theme-row-label' }, label),
  ]);
  const seg = el('div', { class: 'theme-seg', role: 'tablist', 'aria-label': label });
  const buttons = options.map((opt) => {
    const btn = el('button', {
      type: 'button',
      role: 'tab',
      'aria-pressed': String(state[key] === opt.id),
      onclick: () => {
        setKey(key, opt.id);
        for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.id === opt.id));
      },
    }, opt.label);
    btn.dataset.id = opt.id;
    return btn;
  });
  for (const b of buttons) seg.appendChild(b);
  wrap.appendChild(seg);
  return wrap;
}

function accentRow() {
  const wrap = el('div', { class: 'theme-row' }, [
    el('span', { class: 'theme-row-label' }, 'Accent'),
  ]);
  const swatches = el('div', { class: 'theme-swatches' });
  const buttons = ACCENTS.map((a) => {
    const sw = el('button', {
      type: 'button',
      class: 'theme-swatch',
      'aria-label': a.id,
      'aria-pressed': String(state.accent === a.id),
      title: a.id.charAt(0).toUpperCase() + a.id.slice(1),
      style: `background:${a.color}`,
      onclick: () => {
        setKey('accent', a.id);
        for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.id === a.id));
      },
    });
    sw.dataset.id = a.id;
    return sw;
  });
  for (const b of buttons) swatches.appendChild(b);
  wrap.appendChild(swatches);
  return wrap;
}

function buildPanel(onClose) {
  const panel = el('div', { class: 'theme-panel', role: 'dialog', 'aria-label': 'Appearance' }, [
    el('p', { class: 'theme-panel-title' }, 'Appearance'),
    seg('Theme', 'theme', [
      { id: 'light',    label: 'Light' },
      { id: 'dark',     label: 'Dark' },
      { id: 'midnight', label: 'Midnight' },
    ]),
    accentRow(),
    seg('Density', 'density', [
      { id: 'comfortable', label: 'Comfortable' },
      { id: 'compact',     label: 'Compact' },
    ]),
    seg('Corners', 'radius', [
      { id: 'sharp',   label: 'Sharp' },
      { id: 'default', label: 'Default' },
      { id: 'soft',    label: 'Soft' },
    ]),
    el('div', { class: 'theme-actions' }, [
      el('button', {
        class: 'theme-reset', type: 'button',
        onclick: () => {
          state = { ...DEFAULTS };
          apply(state);
          save(state);
          onClose();
          mountUI();
        },
      }, 'Reset'),
    ]),
  ]);
  return panel;
}

const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09c0 .67.4 1.27 1.04 1.51.62.26 1.34.12 1.83-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.64.84 1.04 1.51 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.04Z"/>
</svg>`;

let host = null;
let panelOpen = false;

function mountUI() {
  if (!host) {
    host = el('div', { id: 'theme-controls' });
    document.body.appendChild(host);
  }

  const fab = el('button', {
    class: 'theme-fab', type: 'button',
    'aria-label': 'Appearance', title: 'Appearance',
    'aria-expanded': String(panelOpen),
    onclick: (e) => { e.stopPropagation(); panelOpen = !panelOpen; mountUI(); },
    html: GEAR_SVG,
  });

  const children = [fab];
  if (panelOpen) {
    children.push(buildPanel(() => { panelOpen = false; mountUI(); }));
  }
  mount(host, children);
}

function bindOutsideClose() {
  document.addEventListener('click', (e) => {
    if (!panelOpen) return;
    if (host && host.contains(e.target)) return;
    panelOpen = false;
    mountUI();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) { panelOpen = false; mountUI(); }
  });
}

export function initTheme() {
  apply(state);
  mountUI();
  bindOutsideClose();
}
