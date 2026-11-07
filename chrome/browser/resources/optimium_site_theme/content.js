// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

(() => {
  // Only recolor Google search pages; leave other sites unchanged.
  if (!['google.com', 'www.google.com', 'google.ru', 'www.google.ru'].includes(location.hostname) ||
      !['/', '/search', '/webhp'].includes(location.pathname)) {
    return;
  }
  let style;
  let pendingTheme;
  let waitingForDocument = false;
  let revision = 0;
  function applyTheme(theme) {
    if (!document.documentElement) {
      pendingTheme = theme;
      if (!waitingForDocument) {
        waitingForDocument = true;
        document.addEventListener('DOMContentLoaded', () => {
          waitingForDocument = false;
          applyTheme(pendingTheme);
        }, {once: true});
      }
      return;
    }
    style?.remove();
    style = undefined;
    if (!theme?.enabled) {
      return;
    }
    const fallback = theme.dark ?
        {ntp_background: '#211e29', ntp_text: '#f5f1fa', toolbar: '#393344', toolbar_button_icon: '#ded6ee'} :
        {ntp_background: '#f7f5fb', ntp_text: '#24212c', toolbar: '#e8e2f0', toolbar_button_icon: '#524267'};
    const colors = {};
    for (const key of Object.keys(fallback)) {
      const value = theme.colors?.[key];
      colors[key] = typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value) ? value : fallback[key];
    }
    const bg = colors.ntp_background, text = colors.ntp_text;
    const surface = colors.toolbar, accent = colors.toolbar_button_icon;
    const muted = theme.dark ? '#b9b4c1' : '#625c6e';
    const border = theme.dark ? '#524b60' : '#c5bdcf';
    const link = theme.dark ? '#c4b5fd' : '#60418b';
    style = document.createElement('style');
    style.id = 'optimium-site-theme';
    style.textContent = `
      :root { color-scheme: ${theme.dark ? 'dark' : 'light'} !important; }
      html, body, #search, #main, #appbar, #sfcnt, #hdtb, #top_nav, #fbar {
        background-color: ${bg} !important; color: ${text} !important;
      }
      #search :is(h1,h2,h3,h4,p,span,div), #hdtb :is(div,span),
      #appbar :is(div,span), cite { color: inherit; }
      #search :is(.VwiC3b,.YrbPuc,.MUxGbd,.VuuXrf), #result-stats {
        color: ${muted} !important;
      }
      #search a, #search a h3 { color: ${link} !important; }
      .RNNXgb, .aajZCb, .UUbT9, .sfbg, [role="listbox"],
      [role="dialog"], [role="menu"] {
        background-color: ${surface} !important; color: ${text} !important;
        border-color: ${border} !important;
      }
      textarea[name="q"], input[name="q"], .sbct, .wM6W7d {
        color: ${text} !important; background-color: transparent !important;
      }
      .sbct:hover, [role="option"][aria-selected="true"] { background: ${border} !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'optimium-theme') {
      ++revision;
      applyTheme(message.theme);
    }
  });
  chrome.runtime.sendMessage({type: 'optimium-theme'}).then(theme => {
    if (revision === 0) {
      applyTheme(theme);
    }
  }).catch(() => {});
})();
