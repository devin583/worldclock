'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  contains(value) { return this.values.has(value); }
}

class FakeHTMLElement {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this.style = { cssText: '' };
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { this.children.push(child); return child; }
}

const registry = new Map();
const fakeDocument = {
  hidden: true,
  createElement(name) {
    const ElementClass = registry.get(name) || FakeHTMLElement;
    const element = new ElementClass();
    element.localName = name;
    return element;
  },
  addEventListener() {},
  removeEventListener() {},
};

global.HTMLElement = FakeHTMLElement;
global.customElements = {
  define(name, ElementClass) { registry.set(name, ElementClass); },
  get(name) { return registry.get(name); },
};
global.document = fakeDocument;
global.window = { TZ: null };

require('../src/world-clock.js');
const WorldClock = global.window.WCWorldClock;

function descendants(node, localName) {
  const found = [];
  for (const child of node.children) {
    if (child.localName === localName) found.push(child);
    found.push(...descendants(child, localName));
  }
  return found;
}

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must remain a named production function`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test('production WorldPair preserves every flip variant independently from its color scheme', () => {
  const cases = [
    ['classic', 'dark'],
    ['minimal', 'light'],
    ['cute', 'light'],
    ['glass', 'dark'],
  ];

  for (const [variant, colorScheme] of cases) {
    const pair = fakeDocument.createElement('world-pair');
    WorldClock.configureWorldPair(pair, {
      type: 'digital',
      layout: 'row',
      variant,
      colorScheme,
      lang: 'zh',
      clockA: { label: 'Budapest', tz: 'Europe/Budapest' },
      clockB: { label: 'Beijing', tz: 'Asia/Shanghai' },
      showSeconds: false,
      hour12: true,
    });

    pair.connectedCallback();
    const flips = descendants(pair, 'flip-clock');
    assert.equal(flips.length, 2, `${variant} should render two flip clocks`);
    assert.equal(pair.getAttribute('variant'), variant);
    assert.equal(pair.getAttribute('color-scheme'), colorScheme);
    assert.equal(pair.hasAttribute('hour12'), true);
    assert.deepEqual(flips.map((flip) => flip.getAttribute('variant')), [variant, variant]);
    assert.deepEqual(flips.map((flip) => flip.getAttribute('fields')), ['hm', 'hm']);
    assert.deepEqual(flips.map((flip) => flip.getAttribute('tz')), ['Europe/Budapest', 'Asia/Shanghai']);
    assert.equal(flips.every((flip) => flip.hasAttribute('hour12')), true);
    assert.equal(flips.every((flip) => flip.hasAttribute('ampm')), true);
  }
});
test('production main dual builder sends theme, scheme, and 12-hour mode to WorldPair', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const buildDualClockSource = extractNamedFunction(mainSource, 'buildDualClock');
  const mainEl = new FakeHTMLElement();
  const config = { showSeconds: false };
  const testWindow = { WCWorldClock: WorldClock };
  const buildDualClock = Function(
    'mainEl', 'clockScheme', 'config', 'document', 'window',
    `'use strict'; ${buildDualClockSource}; return buildDualClock;`,
  )(mainEl, () => 'light', config, fakeDocument, testWindow);

  buildDualClock(
    'digital',
    'cute',
    'zh',
    true,
    { label: 'Budapest', tz: 'Europe/Budapest' },
    { label: 'Beijing', tz: 'Asia/Shanghai' },
  );

  assert.equal(mainEl.children.length, 1);
  const pair = mainEl.children[0];
  assert.equal(pair.localName, 'world-pair');
  assert.equal(pair.getAttribute('type'), 'digital');
  assert.equal(pair.getAttribute('variant'), 'cute');
  assert.equal(pair.getAttribute('color-scheme'), 'light');
  assert.equal(pair.hasAttribute('hour12'), true);

  pair.connectedCallback();
  const flips = descendants(pair, 'flip-clock');
  assert.equal(flips.length, 2);
  assert.equal(flips.every((flip) => flip.getAttribute('variant') === 'cute'), true);
  assert.equal(flips.every((flip) => flip.hasAttribute('hour12')), true);
  assert.equal(flips.every((flip) => flip.hasAttribute('ampm')), true);
});

test('legacy light/dark WorldPair variants remain compatible', () => {
  for (const [legacy, expected] of [['light', 'minimal'], ['dark', 'classic']]) {
    const pair = fakeDocument.createElement('world-pair');
    pair.setAttribute('type', 'digital');
    pair.setAttribute('variant', legacy);
    pair.connectedCallback();
    const flips = descendants(pair, 'flip-clock');
    assert.deepEqual(flips.map((flip) => flip.getAttribute('variant')), [expected, expected]);
  }
});
