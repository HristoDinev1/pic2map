// Minimal hash-based router — keeps the app a static file set with no server
// rewrite rules required (works from `file://`, any static server, or php -S).

const routes = [];

/** Register a route. `pattern` may contain `:param` segments, e.g. '/albums/:id'. */
export function route(pattern, render) {
  const paramNames = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:[^/]+/g, (m) => { paramNames.push(m.slice(1)); return '([^/]+)'; }) + '$'
  );
  routes.push({ regex, paramNames, render });
}

function currentPath() {
  const hash = location.hash.slice(1);
  return hash ? (hash.startsWith('/') ? hash : `/${hash}`) : '/';
}

export function navigate(path) {
  if (currentPath() === path) { dispatch(); return; }
  location.hash = path;
}

let mountPoint = null;

function dispatch() {
  if (!mountPoint) return;
  const path = currentPath().split('?')[0];
  for (const r of routes) {
    const match = path.match(r.regex);
    if (match) {
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
      r.render(mountPoint, params);
      window.dispatchEvent(new CustomEvent('pic2map:navigated', { detail: { path } }));
      return;
    }
  }
  mountPoint.textContent = 'Page not found.';
}

export function startRouter(node) {
  mountPoint = node;
  window.addEventListener('hashchange', dispatch);
  if (!location.hash) location.hash = '#/';
  dispatch();
}

export function currentRoutePath() {
  return currentPath();
}
