import { el, mount, clear } from '../dom.js';
import { api } from '../api.js';

const STAT_CARDS = [
  ['Users', 'total_users'], ['Moderators', 'total_moderators'], ['Photos', 'total_photos'],
  ['Public', 'public_photos'], ['Geotagged', 'geotagged_photos'], ['Pending review', 'pending_photos'],
  ['Albums', 'total_albums'],
];

function statCard(label, value) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'stat-value' }, String(value)),
    el('div', { class: 'stat-label' }, label),
  ]);
}

export function renderAdminPage(node) {
  const statsGrid = el('div', { class: 'stats-grid' });
  const tbody = el('tbody', {});

  const load = () => {
    api.get('/admin/stats').then((r) => {
      clear(statsGrid);
      const s = r.stats;
      if (!s) return;
      for (const [label, key] of STAT_CARDS) statsGrid.appendChild(statCard(label, s[key]));
      statsGrid.appendChild(statCard('Storage (MB)', Math.round((s.total_storage_bytes || 0) / 1e6)));
    });
    api.get('/admin/users').then((r) => {
      clear(tbody);
      for (const u of r.users) {
        const roleSelect = el('select', {}, ['USER', 'MODERATOR', 'ADMIN'].map((role) =>
          el('option', { value: role, selected: u.role === role }, role)));
        roleSelect.value = u.role;
        roleSelect.addEventListener('change', async () => {
          await api.patch(`/admin/users/${u.id}/role`, { role: roleSelect.value });
          load();
        });
        tbody.appendChild(el('tr', {}, [
          el('td', {}, u.username),
          el('td', { class: 'muted' }, u.email),
          el('td', {}, roleSelect),
          el('td', {}, el('button', {
            class: u.is_active ? 'btn-text' : 'btn-text-danger',
            onclick: async () => { await api.patch(`/admin/users/${u.id}/active`, { active: !u.is_active }); load(); },
          }, u.is_active ? 'Active' : 'Disabled')),
        ]));
      }
    });
  };

  mount(node, [
    el('h1', {}, 'Admin dashboard'),
    statsGrid,
    el('h2', {}, 'Users'),
    el('div', { class: 'table-wrap' },
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Username'), el('th', {}, 'Email'), el('th', {}, 'Role'), el('th', {}, 'Active'),
        ])),
        tbody,
      ])
    ),
  ]);

  load();
}
