// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Run from any directory:
//   node tools/optimium/soundcloud_theme_test.cjs [chromium-checkout-root]
// These dependency-free Node tests check origin restrictions, preference races,
// and reversible styles. They do not replace a real embedded-player smoke test.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const checkout = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const root = path.join(checkout, 'chrome/browser/resources/optimium_site_theme');
const source = fs.readFileSync(path.join(root, 'soundcloud.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const flush = () => new Promise(resolve => setImmediate(resolve));
function page(options = {}) {
  const out = {styles: [], messages: [], listener: null, ready: null, observer: null};
  const theme = options.theme || {enabled: true, dark: true};
  const content = {};
  const sound = {querySelector: () => content};
  let loaded = options.loaded !== false;
  const head = {appendChild(style) {out.styles.push(style);}};
  const document = {
    head: options.rootPresent === false ? null : head,
    documentElement: options.rootPresent === false ? null : head,
    querySelector: () => loaded ? sound : null,
    createElement: () => ({remove() {out.styles = out.styles.filter(x => x !== this);}}),
    addEventListener(name, callback) {assert.equal(name, 'DOMContentLoaded');out.ready = callback;},
  };
  const chrome = {runtime: {
    onMessage: {addListener(fn) {out.listener = fn;}},
    sendMessage: async message => {out.messages.push(message);return theme;},
  }};
  vm.runInNewContext(source, {
    chrome, document, console,
    location: {origin: options.origin || 'https://w.soundcloud.com', pathname: options.path || '/player/', ancestorOrigins: options.ancestors || ['chrome://new-tab-page']},
    getComputedStyle: () => ({backgroundColor: options.bg || 'rgb(245, 245, 245)', colorScheme: 'normal'}),
    MutationObserver: class {constructor(fn) {this.fn = fn;out.observer = this;} observe() {} disconnect() {this.disconnected = true;}},
    setTimeout: () => 1, clearTimeout() {},
  });
  out.mount = () => {document.head = head;document.documentElement = head;out.ready?.();};
  out.load = () => {loaded = true;out.observer?.fn();};
  return out;
}
let passed = 0;
async function test(name, fn) {await fn();console.log('PASS', name);passed++;}
(async () => {
  await test('manifest restricts frame script to exact player origin', () => {
    const entry = manifest.content_scripts.find(x => x.js.includes('soundcloud.js'));
    assert.deepEqual(entry.matches, ['https://w.soundcloud.com/player/*']);assert.equal(entry.all_frames, true);
  });
  await test('no scripts or requests on SoundCloud top-level and unrelated parents', async () => {
    for (const ancestors of [[], ['https://example.org'], ['chrome://new-tab-page', 'https://example.org']]) {
      const p = page({ancestors});await flush();assert.equal(p.messages.length, 0);assert.equal(p.styles.length, 0);
    }
  });
  await test('signin and non-player pages remain untouched', async () => {
    for (const options of [{origin:'https://secure.soundcloud.com'}, {path:'/signin'}, {path:'/player/unrelated'}]) {
      const p = page(options);await flush();assert.equal(p.messages.length, 0);
    }
  });
  await test('track keeps opaque original surface; script never changes text, media, or account', async () => {
    const p=page();await flush();assert.equal(p.styles.length,1);
    const css=p.styles[0].textContent;
    assert.match(css,/background-color: rgb\(245, 245, 245\)/);
    assert.match(css,/color-scheme: dark/);
    assert.doesNotMatch(css,/(?:^|[;{\s])(?:color|opacity|filter)\s*:/);
    assert.doesNotMatch(source,/\b(fetch|cookie|localStorage|sessionStorage|play\(|pause\()/);
  });
  await test('disabled setting restores original page', async () => {
    const p=page();await flush();p.listener({type:'optimium-theme',theme:{enabled:false}});assert.equal(p.styles.length,0);
  });
  await test('stale preference response never overwrites later broadcast', async () => {
    const p=page({rootPresent:false});p.listener({type:'optimium-theme',theme:{enabled:true,dark:false}});
    await flush();p.mount();assert.equal(p.styles.length,1);assert.match(p.styles[0].textContent,/color-scheme: light/);
  });
  await test('initial missing document waits until ready', async () => {
    const p=page({rootPresent:false});await flush();assert.equal(p.styles.length,0);p.mount();assert.equal(p.styles.length,1);
  });
  await test('unknown or playlist DOM retains original rendering', async () => {
    const p=page({loaded:false});await flush();assert.equal(p.styles.length,0);assert.ok(p.observer);
  });
  await test('late track rendering applies once and disconnects observation', async () => {
    const p=page({loaded:false});await flush();const observer=p.observer;p.load();assert.equal(p.styles.length,1);assert.equal(observer.disconnected,true);
  });
  await test('unexpected or transparent original background stays unchanged', async () => {
    for(const bg of ['rgba(0, 0, 0, 0)', 'red;display:none', 'color(srgb 0 0 0)']) {
      const p=page({bg});await flush();assert.equal(p.styles.length,0);
    }
  });
  await test('worker accepts only actual SoundCloud subframe requests', async () => {
    let listener;
    const chrome={runtime:{onMessage:{addListener(fn){listener=fn;}}},settingsPrivate:{getPref(k,fn){fn({value:true});},onPrefsChanged:{addListener(){}}}};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'),{chrome});
    for(const [url,frameId] of [['https://w.soundcloud.com/player/?url=x',0],['https://w.soundcloud.com/signin',1],['https://w.soundcloud.com.evil/player/',1]]) {
      assert.equal(listener({type:'optimium-theme'},{url,frameId,tab:{id:1}},()=>assert.fail()),false);
    }
    assert.equal(listener({type:'optimium-theme'},{url:'https://w.soundcloud.com/player/?url=x',frameId:1,tab:{id:1}},()=>{}),true);
  });
  console.log(JSON.stringify({passed,failed:0}));
})().catch(error => {console.error(error);process.exitCode=1;});
