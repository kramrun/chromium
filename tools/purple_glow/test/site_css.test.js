'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const root = path.resolve(__dirname, '..');
const validator = fs.readFileSync(path.join(root, 'css-validator.js'), 'utf8');
const js = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const handlers = {}, elements = [];
const existing = {textContent:'body { color: blue }', removed:false};
elements.push(existing);
const document = {
  visibilityState: 'visible',
  createElement: () => ({remove() { this.removed = true; }}),
  head: {appendChild(el) {elements.push(el);}},
  addEventListener(n, f) { handlers['doc:' + n] = f; },
  removeEventListener(n) { delete handlers['doc:' + n]; }
};
const window = {addEventListener(n, f) {handlers['win:' + n] = f;}, removeEventListener(n) {delete handlers['win:' + n];}};
const context = {document, window, location:{origin:'https://example.org', href:'https://example.org/start'}};
vm.createContext(context);
vm.runInContext(validator + '\n' + js.slice(js.indexOf('function siteCssAction(')), context);
assert.equal(context.validateUserCss('body { color: red; }'),'body { color: red; }');
assert.throws(() => context.validateUserCss(''));
assert.match(context.siteCssAction('apply','https://example.org','body { color: red; }'),/CSS отправлен/);
const first = elements[1];
assert.equal(first.textContent, 'body { color: red; }');
document.visibilityState = 'hidden';
if (handlers['doc:visibilitychange']) handlers['doc:visibilitychange']();
assert.equal(first.removed, undefined, 'switching tabs should preserve injected CSS');
assert.equal(existing.removed, false);
handlers['win:pagehide']();
assert.equal(first.removed, true, 'pagehide should remove the injected CSS');
assert.equal(existing.removed, false);
assert.match(context.siteCssAction('apply','https://different.example','body{}'),/не применён/);
assert.equal(elements.length, 2);
context.siteCssAction('apply','https://example.org','body { color: pink; }');
const second = elements[2];
context.siteCssAction('remove','https://example.org','');
assert.equal(second.removed, true);
assert.equal(existing.removed, false);
context.siteCssAction('apply','https://example.org','body { color: green; }');
const third = elements[3];
context.location.href = 'https://example.org/other';
assert.equal(third.removed, undefined, 'same-document URL navigation should preserve CSS');
handlers['win:pagehide']();
assert.equal(third.removed, true, 'navigation to another document should remove CSS');
process.stdout.write('CSS stays on tab switch, is removed on pagehide and manual off, and preserves other styles.\n');
