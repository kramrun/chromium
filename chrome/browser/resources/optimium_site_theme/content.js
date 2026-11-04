// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

(() => {
  const youtube = /(^|\.)youtube\.com$/.test(location.hostname);
  // Account/payment pages retain their own presentation. No video/image filters
  // or page-wide opacity: only supported site surfaces are recolored.
  if (!youtube &&
      (!['google.com', 'www.google.com', 'google.ru', 'www.google.ru'].includes(location.hostname) ||
       !['/', '/search', '/webhp'].includes(location.pathname))) {
    return;
  }
  let style;
  let pendingTheme;
  let waitingForDocument = false;
  let revision = 0;
  let previousYoutubeDark;
  let youtubeDarkObserver;
  let desiredYoutubeDark = false;
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
      if (youtubeDarkObserver) {
        youtubeDarkObserver.disconnect();
        youtubeDarkObserver = undefined;
        document.documentElement.toggleAttribute('dark', previousYoutubeDark);
        previousYoutubeDark = undefined;
      }
      return;
    }
    if (youtube) {
      // YouTube uses this attribute for many components in addition to its
      // color variables. Without it, icons can be black on a dark background.
      // Keep its previous preference so disabling Optimium's site theme does
      // not permanently change the site's own appearance setting.
      if (!youtubeDarkObserver) {
        previousYoutubeDark = document.documentElement.hasAttribute('dark');
        youtubeDarkObserver = new MutationObserver(() => {
          const isDark = document.documentElement.hasAttribute('dark');
          if (isDark !== desiredYoutubeDark) {
            previousYoutubeDark = isDark;
            document.documentElement.toggleAttribute('dark', desiredYoutubeDark);
          }
        });
        youtubeDarkObserver.observe(document.documentElement,
                                    {attributes: true, attributeFilter: ['dark']});
      }
      desiredYoutubeDark = theme.dark !== false;
      document.documentElement.toggleAttribute('dark', desiredYoutubeDark);
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
    style.textContent = youtube ? `
      html, ytd-app, ytd-page-manager {
        color-scheme: ${theme.dark ? 'dark' : 'light'} !important;
        --yt-spec-base-background: ${bg} !important;
        --yt-spec-raised-background: ${surface} !important;
        --yt-spec-menu-background: ${surface} !important;
        --yt-spec-brand-background-primary: ${bg} !important;
        --yt-spec-brand-background-secondary: ${surface} !important;
        --yt-spec-text-primary: ${text} !important;
        --yt-spec-text-secondary: ${muted} !important;
        --yt-spec-icon-active-other: ${accent} !important;
        --yt-spec-icon-inactive: ${muted} !important;
        --yt-spec-badge-chip-background: ${surface} !important;
        --yt-spec-button-chip-background-hover: ${border} !important;
        --yt-spec-10-percent-layer: ${border} !important;
        --yt-spec-general-background-a: ${bg} !important;
        --yt-spec-general-background-b: ${bg} !important;
        --ytd-searchbox-background: ${bg} !important;
        --ytd-searchbox-text-color: ${text} !important;
        --ytd-searchbox-border-color: ${border} !important;
        --ytd-searchbox-legacy-button-color: ${surface} !important;
        --ytd-searchbox-legacy-button-border-color: ${border} !important;
        --yt-spec-call-to-action: ${link} !important;
      }
      html, body, ytd-app { background: ${bg} !important; color: ${text} !important; }
      ytd-masthead, #background.ytd-masthead, tp-yt-app-drawer,
      ytd-guide-renderer, ytd-mini-guide-renderer {
        background: ${bg} !important;
      }
      yt-searchbox .ytSearchboxComponentInputBox,
      yt-searchbox .ytSearchboxComponentSuggestionsContainer {
        background: ${surface} !important; color: ${text} !important;
      }
    ` : `
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
