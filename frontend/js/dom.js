// Tiny DOM-builder helper — no framework, just a thin layer over document.createElement.

/**
 * el('div', { class: 'card', onclick: fn }, ['text', otherEl])
 * - Props starting with "on" are bound as event listeners.
 * - `class` / `className` set className; everything else is set as an attribute
 *   (or property when the value isn't a string, e.g. `value`, `checked`, `disabled`).
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class' || key === 'className') {
      node.className = value;
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (typeof value === 'boolean' || key === 'value' || key === 'checked') {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node, children) {
  clear(node);
  appendChildren(node, children);
  return node;
}

export function text(node, value) {
  node.textContent = value;
  return node;
}
