import { route, startRouter, navigate } from './router.js';
import { renderNavbar } from './navbar.js';
import { renderAuthScreen } from './auth-screen.js';
import { authStore } from './auth-store.js';
import { auth } from './auth.js';
import { mount, el } from './dom.js';
import { initTheme } from './theme.js';

import { renderMapPage } from './pages/map.js';
import { renderGalleryPage } from './pages/gallery.js';
import { renderUploadPage } from './pages/upload.js';
import { renderAlbumsPage } from './pages/albums.js';
import { renderAlbumDetailPage } from './pages/album-detail.js';
import { renderSearchPage } from './pages/search.js';
import { renderModerationPage } from './pages/moderation.js';
import { renderAdminPage } from './pages/admin.js';

const RANK = { USER: 1, MODERATOR: 2, ADMIN: 3 };

function guard(render, minRole) {
  return (node, params) => {
    if (minRole) {
      const role = (authStore.profile && authStore.profile.role) || 'USER';
      if (RANK[role] < RANK[minRole]) {
        mount(node, el('p', { class: 'error' }, 'You do not have permission to view this page.'));
        return;
      }
    }
    render(node, params);
  };
}

route('/', guard(renderMapPage));
route('/gallery', guard(renderGalleryPage));
route('/upload', guard(renderUploadPage));
route('/albums', guard(renderAlbumsPage));
route('/albums/:id', guard(renderAlbumDetailPage));
route('/search', guard(renderSearchPage));
route('/moderation', guard(renderModerationPage, 'MODERATOR'));
route('/admin', guard(renderAdminPage, 'ADMIN'));

const navbarNode = document.getElementById('navbar');
const appNode = document.getElementById('app');

async function boot() {
  initTheme();
  // Use the driver-aware facade — `cognito.isSignedIn()` would only inspect
  // the Cognito module's in-memory session and is wrong under AUTH_DRIVER=local.
  if (!auth.isSignedIn()) {
    renderAuthScreen(appNode, start);
    return;
  }
  await authStore.refresh();
  start();
}

function start() {
  renderNavbar(navbarNode);
  startRouter(appNode);
  if (location.hash === '' || location.hash === '#') navigate('/');
}

boot();
