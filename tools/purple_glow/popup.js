'use strict';
const mode = document.getElementById('mode');
const status = document.getElementById('status');
const color = document.getElementById('color');
chrome.storage.local.get({mode: 'animated', color: 'purple'}).then(v => { mode.value = v.mode; color.value = v.color; });
mode.addEventListener('change', () => chrome.storage.local.set({mode: mode.value}));
color.addEventListener('change', () => chrome.storage.local.set({color: color.value}));
document.getElementById('newtab').addEventListener('click', () => chrome.tabs.create({url: chrome.runtime.getURL('newtab.html')}));
async function run(action) {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('Откройте обычную страницу http или https.');
    const [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: pageEffect, args: [action, mode.value, color.value]});
    status.textContent = result.result;
  } catch (e) { status.textContent = 'Не удалось применить: ' + e.message; }
}
document.getElementById('apply').addEventListener('click', () => run('apply'));
document.getElementById('remove').addEventListener('click', () => run('remove'));
function pageEffect(action, mode, color) {
  const KEY = '__purpleGlowCleanup_5c8b17';
  if (typeof window[KEY] === 'function') window[KEY]();
  if (action === 'remove') return 'Эффект выключен.';
  // Conservative: mark only empty, visible elements without generated content.
  // An overlay can still be drawn later; stop on page mutations and scrolling.
  const candidates = [];
  const rects = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node, count = 0;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue.trim()) continue;
    if (++count > 3500) return 'Слишком сложная страница: эффект не включён.';
    const range = document.createRange(); range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (r.width && r.height) rects.push(r);
    range.detach();
  }
  for (const el of document.querySelectorAll('img, video, canvas, iframe, svg, input, textarea, select, button, [contenteditable]')) {
    const r = el.getBoundingClientRect(); if (r.width && r.height) rects.push(r);
  }
  const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const el of document.querySelectorAll('div, section, aside, span')) {
    if (candidates.length >= 20) break;
    if (el.childNodes.length || el.isContentEditable || el.closest('a,button,[contenteditable],video,svg')) continue;
    const s = getComputedStyle(el), before = getComputedStyle(el, '::before'), after = getComputedStyle(el, '::after');
    if (s.display === 'none' || s.visibility !== 'visible' || s.backgroundImage !== 'none' || s.animationName !== 'none' || Number(s.opacity) < 1) continue;
    if (![before.content, after.content].every(x => x === 'none' || x === 'normal')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
    if (rects.some(t => intersects(r, t))) continue;
    candidates.push(el);
  }
  if (!candidates.length) return 'Подходящих пустых областей не найдено.';
  const original = candidates.map(el => [el, el.style.getPropertyValue('background-image'), el.style.getPropertyPriority('background-image'), el.style.getPropertyValue('background-size'), el.style.getPropertyPriority('background-size'), el.style.getPropertyValue('animation'), el.style.getPropertyPriority('animation')]);
  const style = document.createElement('style');
  style.textContent = '@keyframes purpleGlow5c8b17{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}';
  document.head.appendChild(style);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const animate = mode === 'animated' && !motion.matches;
  const colors = {purple: ['130,80,210','85,50,160'], blue: ['55,110,220','30,65,150'], turquoise: ['20,155,150','20,95,120'], pink: ['205,80,155','155,50,125']};
  const selected = colors[color] || colors.purple;
  for (const [index, el] of candidates.entries()) {
    el.style.setProperty('background-image', `linear-gradient(120deg, rgba(${selected[0]},.20), rgba(${selected[1]},.12), rgba(${selected[0]},.20))`, 'important');
    el.style.setProperty('background-size', '250% 250%', 'important');
    if (animate) el.style.setProperty('animation', 'purpleGlow5c8b17 18s ease-in-out infinite', 'important');
    const applied = {};
    for (const key of ['background-image', 'background-size', ...(animate ? ['animation'] : [])]) {
      applied[key] = [el.style.getPropertyValue(key), el.style.getPropertyPriority(key)];
    }
    original[index].push(applied);
  }
  let observer;
  function cleanup() {
    if (observer) observer.disconnect();
    removeEventListener('scroll', cleanup, true); removeEventListener('resize', cleanup); motion.removeEventListener('change', cleanup);
    for (const [el, image, ip, size, sp, animation, ap, applied] of original) {
      for (const [key, value, priority] of [['background-image',image,ip],['background-size',size,sp],['animation',animation,ap]]) {
        if (!applied[key] || el.style.getPropertyValue(key) !== applied[key][0] || el.style.getPropertyPriority(key) !== applied[key][1]) continue;
        if (value) el.style.setProperty(key, value, priority); else el.style.removeProperty(key);
      }
    }
    style.remove(); delete window[KEY];
  }
  window[KEY] = cleanup;
  observer = new MutationObserver(cleanup);
  observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
  addEventListener('scroll', cleanup, true); addEventListener('resize', cleanup); motion.addEventListener('change', cleanup);
  return `Эффект включён: областей ${candidates.length}. При изменении или прокрутке страницы отключится.`;
}
