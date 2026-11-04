// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

(() => {
  // This presentation change belongs only to Optimium's own new-tab widget.
  // Do not touch SoundCloud's sign-in, website, or embeds on other websites.
  if (location.origin !== 'https://w.soundcloud.com' ||
      !['/player', '/player/'].includes(location.pathname) ||
      location.ancestorOrigins.length !== 1 ||
      location.ancestorOrigins[0] !== 'chrome://new-tab-page') {
    return;
  }

  let style;
  let observer;
  let timeout;
  let pendingTheme;
  let revision = 0;
  function stopWaiting() {
    observer?.disconnect();
    observer = undefined;
    clearTimeout(timeout);
  }

  function applyTheme(theme) {
    pendingTheme = theme;
    stopWaiting();
    style?.remove();
    style = undefined;
    if (!theme?.enabled || !document.documentElement) {
      return;
    }

    // Only the standard single-track layout has been verified. Unknown or
    // playlist layouts keep SoundCloud's original presentation.
    const sound = document.querySelector(
        '#widget .singleSound .sound.g-background-default');
    if (!sound?.querySelector('.sound__content')) {
      observer = new MutationObserver(() => {
        if (document.querySelector(
                '#widget .singleSound .sound.g-background-default .sound__content')) {
          applyTheme(pendingTheme);
        }
      });
      observer.observe(document.documentElement, {childList: true, subtree: true});
      timeout = setTimeout(stopWaiting, 15000);
      return;
    }

    // Keep the original opaque surface behind the track, waveform and labels.
    // Never change text/icon colors, opacity, playback, or account state.
    const original = getComputedStyle(sound);
    const surface = original.backgroundColor;
    if (!/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(surface)) {
      return;
    }
    const scheme = ['normal', 'light', 'dark', 'light dark', 'dark light'].includes(
        original.colorScheme) ? original.colorScheme : 'normal';
    style = document.createElement('style');
    style.id = 'optimium-soundcloud-surface';
    style.textContent = `
      :root { color-scheme: ${theme.dark === false ? 'light' : 'dark'} !important; }
      html, body, #widget.widget,
      #widget .singleSound .sound.g-background-default {
        background-color: transparent !important;
        box-shadow: none !important;
      }
      #widget.widget {
        background-image: none !important;
        border-color: transparent !important;
      }
      #widget .singleSound .sound.g-background-default {
        border-color: transparent !important;
      }
      #widget .singleSound .sound__content {
        background-color: ${surface} !important;
        color-scheme: ${scheme} !important;
        border-radius: 12px;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // At document_start, even documentElement may not exist yet. A later theme
  // broadcast must win over the asynchronous initial preference response.
  document.addEventListener('DOMContentLoaded', () => applyTheme(pendingTheme),
                            {once: true});
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
