// A tiny hand-written DOM stub — just enough surface for the app's own
// dom.js helper and page modules to run under `node --test`. No jsdom, no
// libraries; same "from scratch" philosophy as the rest of the project.

export class StubNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  append(...children) { for (const c of children) if (c != null) this.appendChild(c); }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) { this.childNodes.splice(i, 1); child.parentNode = null; }
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn, opts) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ fn, once: !!(opts && opts.once) });
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((l) => l.fn !== fn));
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    const list = (this.listeners.get(event.type) || []).slice();
    for (const l of list) {
      l.fn.call(this, event);
      if (l.once) this.removeEventListener(event.type, l.fn);
    }
    return true;
  }
}

export class StubText extends StubNode {
  constructor(data) { super(); this.data = String(data); }
  get textContent() { return this.data; }
}

export class StubElement extends StubNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this.value = '';
    this._className = '';
    this.classList = {
      add: (...cls) => { const s = new Set(this._className.split(/\s+/).filter(Boolean)); cls.forEach((c) => s.add(c)); this._className = [...s].join(' '); },
      remove: (...cls) => { const s = new Set(this._className.split(/\s+/).filter(Boolean)); cls.forEach((c) => s.delete(c)); this._className = [...s].join(' '); },
      contains: (c) => this._className.split(/\s+/).includes(c),
    };
  }
  get className() { return this._className; }
  set className(v) { this._className = v; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '') this.appendChild(new StubText(v)); }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { this.textContent = v; }
  get clientWidth() { return this._clientWidth || 0; }
  get clientHeight() { return this._clientHeight || 0; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  focus() {}
  blur() {}
  click() { this.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} }); }
  setPointerCapture() {}
  releasePointerCapture() {}
}

/** Depth-first search through a stub tree. */
export function findAll(root, predicate, out = []) {
  for (const child of root.childNodes || []) {
    if (child instanceof StubElement) {
      if (predicate(child)) out.push(child);
      findAll(child, predicate, out);
    }
  }
  return out;
}
export function findOne(root, predicate) { return findAll(root, predicate)[0] || null; }

/**
 * Install browser-ish globals before importing app modules.
 * Returns the stubbed pieces for assertions/cleanup.
 */
export function installDom({ config } = {}) {
  const document = {
    createElement: (tag) => new StubElement(tag),
    createTextNode: (data) => new StubText(data),
    body: new StubElement('body'),
    addEventListener() {}, removeEventListener() {},
  };
  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const windowStub = new StubNode();
  windowStub.PIC2MAP_CONFIG = config || { apiBase: 'http://api.test/api', cognitoRegion: 'eu-test-1', cognitoClientId: 'client' };
  windowStub.location = { hash: '' };

  globalThis.document = document;
  globalThis.window = windowStub;
  globalThis.Node = StubNode;
  globalThis.localStorage = localStorage;
  globalThis.location = windowStub.location;
  globalThis.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = () => {};

  return { document, windowStub, localStorage };
}

/** Flush microtasks + timers-at-0 a few times so async UI flows settle. */
export async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
