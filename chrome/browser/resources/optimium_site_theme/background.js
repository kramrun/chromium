// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// The worker sleeps when idle. Only these two preferences are sent to pages;
// neither browser history nor any other settings are exposed to content scripts.
const THEME_PREF = 'optimium.appearance.theme';
const ENABLED_PREF = 'optimium.appearance.website_theme_enabled';

function readPref(name) {
  return new Promise(resolve => chrome.settingsPrivate.getPref(name, pref => {
    resolve(chrome.runtime.lastError ? undefined : pref?.value);
  }));
}

async function getTheme() {
  const [theme, enabled] = await Promise.all([
    readPref(THEME_PREF), readPref(ENABLED_PREF),
  ]);
  const colors = {};
  for (const key of ['ntp_background', 'ntp_text', 'toolbar', 'toolbar_button_icon']) {
    const value = theme?.colors?.[key];
    if (typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)) {
      colors[key] = value;
    }
  }
  return {enabled: enabled === true, dark: theme?.dark !== false, colors};
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const supportedSite =
      /^https:\/\/([a-z\d-]+\.)*(youtube\.com|google\.com|google\.ru)\//i.test(sender.url || '');
  const soundcloudFrame = sender.frameId > 0 &&
      /^https:\/\/w\.soundcloud\.com\/player\/(?:\?|$)/.test(sender.url || '');
  if (message?.type !== 'optimium-theme' || !sender.tab ||
      (!supportedSite && !soundcloudFrame)) {
    return false;
  }
  getTheme().then(respond);
  return true;
});

chrome.settingsPrivate.onPrefsChanged.addListener(async prefs => {
  if (!prefs.some(pref => pref.key === THEME_PREF || pref.key === ENABLED_PREF)) {
    return;
  }
  const theme = await getTheme();
  // SoundCloud is a subframe of chrome://newtab, which cannot be selected by
  // host-permission URL filters. Tab IDs require no extra permissions; only our
  // own content scripts receive these sanitized presentation preferences.
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, {type: 'optimium-theme', theme}).catch(() => {});
  }
});
