import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubElement } from './dom-stub.js';

installDom();
const { el, mount, clear } = await import('../js/dom.js');
const { route, startRouter, navigate } = await import('../js/router.js');

test('el() builds elements with attributes, classes, props and listeners', () => {
  let clicks = 0;
  const node = el('button', { class: 'btn', disabled: true, 'data-x': '1', onclick: () => clicks++ }, ['Hi ', el('b', {}, 'there')]);
  assert.equal(node.tagName, 'BUTTON');
  assert.equal(node.className, 'btn');
  assert.equal(node.disabled, true);
  assert.equal(node.getAttribute('data-x'), '1');
  assert.equal(node.textContent, 'Hi there');
  node.dispatchEvent({ type: 'click' });
  assert.equal(clicks, 1);
});

test('el() skips null/false children and flattens arrays', () => {
  const node = el('div', {}, [null, false, ['a', [el('span', {}, 'b')]], 'c']);
  assert.equal(node.textContent, 'abc');
});

test('mount() replaces previous content; clear() empties', () => {
  const host = new StubElement('div');
  mount(host, el('p', {}, 'one'));
  mount(host, [el('p', {}, 'two'), 'tail']);
  assert.equal(host.textContent, 'twotail');
  clear(host);
  assert.equal(host.childNodes.length, 0);
});

test('router matches static and parameterised routes', () => {
  const hits = [];
  route('/', (node) => hits.push(['home']));
  route('/albums/:id', (node, params) => hits.push(['album', params.id]));
  route('/a/:x/b/:y', (node, params) => hits.push(['ab', params.x, params.y]));

  const mountNode = new StubElement('main');

  location.hash = '#/albums/42';
  startRouter(mountNode);
  assert.deepEqual(hits.at(-1), ['album', '42']);

  location.hash = '#/a/one/b/two%20three';
  window.dispatchEvent(new CustomEvent('hashchange'));
  // The stub window doesn't auto-fire listeners on hash assignment, so call
  // navigate() to dispatch directly:
  navigate('/a/one/b/two%20three');
  assert.deepEqual(hits.at(-1), ['ab', 'one', 'two three']);

  location.hash = '#/';
  navigate('/');
  assert.deepEqual(hits.at(-1), ['home']);
});

test('router shows not-found for unknown paths', () => {
  const mountNode = new StubElement('main');
  location.hash = '#/nope/missing';
  startRouter(mountNode);
  assert.match(mountNode.textContent, /not found/i);
});
