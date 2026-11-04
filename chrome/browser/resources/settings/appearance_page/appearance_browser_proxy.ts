// Copyright 2016 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// clang-format off
import {sendWithPromise} from 'chrome://resources/js/cr.js';

import {loadTimeData} from '../i18n_setup.js';
// clang-format on

export interface OptimiumTheme {
  name: string;
  dark: boolean;
  colors: Record<string, string>;
}

export interface AppearanceBrowserProxy {
  getOptimiumTheme(): Promise<Partial<OptimiumTheme>>;
  applyOptimiumTheme(theme: OptimiumTheme): Promise<boolean>;
  getOptimiumAppearanceOptions(): Promise<Record<string, string|number|boolean>>;
  setOptimiumAppearanceOption(name: string, value: string|number|boolean): Promise<boolean>;

  getDefaultZoom(): Promise<number>;
  getThemeInfo(themeId: string): Promise<chrome.management.ExtensionInfo>;

  /** @return Whether the current profile is a child account. */
  isChildAccount(): boolean;

  openCustomizeChrome(): void;
  openCustomizeChromeToolbarSection(): void;
  recordGlassFrameEnabledChanged(enabled: boolean): void;
  recordHoverCardImagesEnabledChanged(enabled: boolean): void;
  recordHoverCardMemoryUsageEnabledChanged(enabled: boolean): void;
  recordVerticalTabStripModeChanged(enabled: boolean): void;
  resetPinnedToolbarActions(): void;
  useDefaultTheme(): void;

  // <if expr="is_linux">
  useGtkTheme(): void;
  useQtTheme(): void;
  // </if>

  validateStartupPage(url: string): Promise<boolean>;
  pinnedToolbarActionsAreDefault(): Promise<boolean>;
}

export class AppearanceBrowserProxyImpl implements AppearanceBrowserProxy {
  getOptimiumTheme() {
    return sendWithPromise<Partial<OptimiumTheme>>('getOptimiumTheme');
  }

  applyOptimiumTheme(theme: OptimiumTheme) {
    return sendWithPromise<boolean>('applyOptimiumTheme', theme);
  }

  getOptimiumAppearanceOptions() {
    return sendWithPromise<Record<string, string|number|boolean>>(
        'getOptimiumAppearanceOptions');
  }

  setOptimiumAppearanceOption(name: string, value: string|number|boolean) {
    return sendWithPromise<boolean>('setOptimiumAppearanceOption', name, value);
  }

  getDefaultZoom(): Promise<number> {
    return chrome.settingsPrivate.getDefaultZoom();
  }

  getThemeInfo(themeId: string): Promise<chrome.management.ExtensionInfo> {
    return chrome.management.get(themeId);
  }

  isChildAccount() {
    return loadTimeData.getBoolean('isChildAccount');
  }

  openCustomizeChrome() {
    chrome.send('openCustomizeChrome');
  }

  openCustomizeChromeToolbarSection() {
    chrome.send('openCustomizeChromeToolbarSection');
  }

  recordGlassFrameEnabledChanged(enabled: boolean) {
    chrome.metricsPrivate.recordBoolean('Settings.GlassFrame.Enabled', enabled);
  }

  recordHoverCardImagesEnabledChanged(enabled: boolean) {
    chrome.metricsPrivate.recordBoolean(
        'Settings.HoverCards.ImagePreview.Enabled', enabled);
  }

  recordHoverCardMemoryUsageEnabledChanged(enabled: boolean) {
    chrome.metricsPrivate.recordBoolean(
        'Settings.HoverCards.MemoryUsage.Enabled', enabled);
  }

  recordVerticalTabStripModeChanged(enabled: boolean) {
    chrome.send('recordVerticalTabStripModeChanged', [enabled]);
  }

  resetPinnedToolbarActions() {
    chrome.send('resetPinnedToolbarActions');
  }

  useDefaultTheme() {
    chrome.send('useDefaultTheme');
  }

  // <if expr="is_linux">
  useGtkTheme() {
    chrome.send('useGtkTheme');
  }

  useQtTheme() {
    chrome.send('useQtTheme');
  }
  // </if>

  validateStartupPage(url: string) {
    return sendWithPromise<boolean>('validateStartupPage', url);
  }

  pinnedToolbarActionsAreDefault() {
    return sendWithPromise<boolean>('pinnedToolbarActionsAreDefault');
  }

  static getInstance(): AppearanceBrowserProxy {
    return instance || (instance = new AppearanceBrowserProxyImpl());
  }

  static setInstance(obj: AppearanceBrowserProxy) {
    instance = obj;
  }
}

let instance: AppearanceBrowserProxy|null = null;
