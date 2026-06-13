import { el, mount } from './dom.js';
import { authStore } from './auth-store.js';
import { currentRoutePath } from './router.js';

const LINKS = [
  { path: '/', label: 'Map' },
  { path: '/gallery', label: 'Gallery' },
  { path: '/albums', label: 'Albums' },
  { path: '/search', label: 'Search' },
  { path: '/upload', label: 'Upload' },
  { path: '/moderation', label: 'Moderation', minRole: 'MODERATOR' },
  { path: '/admin', label: 'Admin', minRole: 'ADMIN' },
];
const RANK = { USER: 1, MODERATOR: 2, ADMIN: 3 };

function navLink(path, label) {
  const active = currentRoutePath() === path;
  return el('a', { href: `#${path}`, class: `nav-link${active ? ' active' : ''}` }, label);
}

export function renderNavbar(node) {
  const render = ({ profile }) => {
    const role = profile ? profile.role : 'USER';
    const links = LINKS.filter((l) => !l.minRole || RANK[role] >= RANK[l.minRole]);

    mount(node, el('nav', { class: 'navbar' }, [
      el('div', { class: 'navbar-inner' }, [
        el('span', { class: 'brand' }, 'PIC2MAP'),
        ...links.map((l) => navLink(l.path, l.label)),
        el('div', { class: 'nav-spacer' }, [
          profile ? el('span', { class: 'nav-user' }, `${profile.username} · ${role}`) : null,
          profile ? el('button', {
            class: 'btn-link-danger',
            onclick: async () => { await authStore.logout(); location.reload(); },
          }, 'Sign out') : null,
        ]),
      ]),
    ]));
  };

  authStore.subscribe(render);
  window.addEventListener('hashchange', () => render({ profile: authStore.profile, loading: authStore.loading }));
}
