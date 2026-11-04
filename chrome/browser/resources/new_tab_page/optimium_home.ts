// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '/strings.m.js';

import {ColorChangeUpdater} from 'chrome://resources/cr_components/color_change_listener/colors_css_updater.js';
// Optimium's native side panel uses a dedicated trusted-WebUI message handler.
// eslint-disable-next-line no-restricted-imports
import {sendWithPromise} from 'chrome://resources/js/cr.js';
import {loadTimeData} from 'chrome://resources/js/load_time_data.js';
import {css, html, LitElement, nothing} from 'chrome://resources/lit/v3_0/lit.rollup.js';

// Declarative dashboard data only. Imported configuration never executes code,
// injects CSS, or supplies HTML. Network widgets are disabled by default.
const CONFIG_KEY = 'optimium.home.v1';
const HISTORY_KEY = 'optimium.home.history.v1';
const WEATHER_KEY = 'optimium.home.weather.v1';
const ICONS: {[key: string]: string} = {
  search: 'm21 21-4.3-4.3 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  palette: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.7h2a4 4 0 0 0 4-4A8.6 8.6 0 0 0 12 3 M7 10h.01 M10 7h.01 M15 7h.01 M17 10h.01',
  close: 'm6 6 12 12 M6 18 18 6',
  plus: 'M12 5v14 M5 12h14',
  link: 'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
  music: 'M9 18V5l12-2v13 M9 5v4l12-2 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  previous: 'M6 5v14 M19 5 8 12l11 7z',
  next: 'M18 5v14 M5 5l11 7-11 7z',
  play: 'm8 5 11 7-11 7z',
  pause: 'M8 5v14 M16 5v14',
  video: 'M9 8l7 4-7 4z M3 5h18v14H3z',
  code: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 4l-4 16',
  book: 'M4 3h7v18H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2 M11 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-9 M6 7h2 M6 11h2 M15 7h3 M15 11h3',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18',
  history: 'M3 11a9 9 0 1 1 3 8 M3 4v7h7 M12 7v5l3 2',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  cloud: 'M7 18a5 5 0 1 1 0-10 6 6 0 0 1 11 2 4 4 0 1 1 0 8z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
  'cloud-sun': 'M8 2v2 M2 8h2 M3.8 3.8l1.4 1.4 M12.8 5.2l1.4-1.4 M7 12a4 4 0 1 1 5-5 M8 20a4 4 0 1 1 .5-8 5 5 0 0 1 9.5 1 3.5 3.5 0 1 1 0 7z',
  rain: 'M7 15a4 4 0 1 1 .5-8 5 5 0 0 1 9.5 1 3.5 3.5 0 1 1 0 7 M8 18l-1 3 M13 18l-1 3 M18 18l-1 3',
  snow: 'M12 2v20 M3.3 7l17.4 10 M3.3 17 20.7 7 M9 4l3 3 3-3 M9 20l3-3 3 3 M3.5 10l4-1-1-4 M17.5 19l-1-4 4-1 M3.5 14l4 1-1 4 M17.5 5l-1 4 4 1',
  fog: 'M7 12a4 4 0 1 1 .5-8 5 5 0 0 1 9.5 1 3.5 3.5 0 1 1 0 7 M3 16h18 M5 20h14',
  storm: 'M7 15a4 4 0 1 1 .5-8 5 5 0 0 1 9.5 1 3.5 3.5 0 1 1 0 7 M13 12l-4 6h5l-3 5',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
};
type Hero = 'clock'|'clock-weather'|'google'|'weather'|'text'|'none';
type ClockStyle = 'display'|'soft'|'modern'|'condensed'|'mono'|'serif'|'light';
const CLOCK_STYLES: Array<{id: ClockStyle; label: string}> = [
  {id: 'display', label: 'Выразительный'},
  {id: 'soft', label: 'Мягкий'},
  {id: 'modern', label: 'Современный'},
  {id: 'condensed', label: 'Узкий'},
  {id: 'mono', label: 'Моноширинный'},
  {id: 'serif', label: 'С засечками'},
  {id: 'light', label: 'Тонкий'},
];
interface Shortcut {name: string; url: string; icon: string;}
interface HomeConfig {
  version: 1;
  hero: Hero;
  heading: string;
  showHeading: boolean;
  customText: string;
  clock24: boolean;
  clockStyle: ClockStyle;
  clockWeatherStyle: ClockStyle;
  showDate: boolean;
  compact: boolean;
  radius: number;
  searchLayoutVersion: 2;
  searchWidth: number;
  surfaceOpacity: number;
  searchPlaceholder: string;
  showHistory: boolean;
  weatherEnabled: boolean;
  city: string;
  soundcloudEnabled: boolean;
  soundcloudMiniEnabled: boolean;
  soundcloudUrl: string;
  shortcuts: Shortcut[];
}
interface WeatherData {city: string; label: string; temperature: number; code: number; time: number;}
interface SoundcloudState {
  available: boolean; playing: boolean; canPlay: boolean; canPause: boolean;
  canPrevious: boolean; canNext: boolean; title: string; artist: string; artwork: string;
}
function defaults(): HomeConfig {
  return {
    version: 1, hero: 'clock', heading: 'Fuck proprietary!', showHeading: true,
    customText: 'Optimium', clock24: true, clockStyle: 'light',
    clockWeatherStyle: 'display', showDate: true, compact: false,
    radius: 24, searchLayoutVersion: 2, searchWidth: 584, surfaceOpacity: 76,
    searchPlaceholder: 'Поиск или адрес сайта', showHistory: true,
    weatherEnabled: false, city: '', soundcloudEnabled: false, soundcloudMiniEnabled: true,
    soundcloudUrl: '', shortcuts: [],
  };
}
function textValue(value: unknown, fallback: string, limit = 120): string {
  return typeof value === 'string' ? value.slice(0, limit) : fallback;
}
function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function soundcloudUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
        ['soundcloud.com', 'www.soundcloud.com', 'api.soundcloud.com'].includes(url.hostname) &&
        !url.username && !url.password && url.pathname !== '/' ? url.href : '';
  } catch { return ''; }
}
function normalizeConfig(value: unknown): HomeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Нужен объект настроек Optimium.');
  }
  const v = value as Record<string, unknown>;
  if (v['version'] !== 1) { throw new Error('Поддерживается версия конфигурации 1.'); }
  const out = defaults();
  const heroes: Hero[] = ['clock', 'clock-weather', 'google', 'weather', 'text', 'none'];
  if (heroes.includes(v['hero'] as Hero)) { out.hero = v['hero'] as Hero; }
  // Separate defaults preserve the original clock in existing v1 profiles.
  for (const key of ['clockStyle', 'clockWeatherStyle'] as const) {
    if (CLOCK_STYLES.some(style => style.id === v[key])) {
      out[key] = v[key] as ClockStyle;
    }
  }
  for (const key of ['showHeading', 'clock24', 'showDate', 'compact', 'showHistory', 'weatherEnabled', 'soundcloudEnabled', 'soundcloudMiniEnabled'] as const) {
    if (typeof v[key] === 'boolean') { out[key] = v[key]; }
  }
  out.heading = textValue(v['heading'], out.heading, 160);
  out.customText = textValue(v['customText'], out.customText, 120);
  out.searchPlaceholder = textValue(v['searchPlaceholder'], out.searchPlaceholder, 80);
  out.city = textValue(v['city'], '', 100).trim();
  out.soundcloudUrl = soundcloudUrl(textValue(v['soundcloudUrl'], '', 2048));
  for (const [key, min, max] of [['radius', 0, 36], ['searchWidth', 360, 900], ['surfaceOpacity', 20, 100]] as const) {
    const n = v[key];
    if (typeof n === 'number' && Number.isFinite(n)) { out[key] = Math.min(max, Math.max(min, n)); }
  }
  // Migrate the old default once; preserve other widths and later selections.
  if (v['searchLayoutVersion'] !== 2 && v['searchWidth'] === 680) {
    out.searchWidth = 584;
  }
  if (Array.isArray(v['shortcuts'])) {
    out.shortcuts = v['shortcuts'].slice(0, 12).flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') { return []; }
      const entry = item as Record<string, unknown>;
      const url = safeUrl(textValue(entry['url'], '', 2048));
      const name = textValue(entry['name'], '', 40).trim();
      const icon = textValue(entry['icon'], 'link', 16);
      return url && name ? [{name, url, icon: ICONS[icon] ? icon : 'link'}] : [];
    });
  }
  return out;
}
function readConfig(): HomeConfig {
  try { return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null')); }
  catch { return defaults(); }
}
function icon(name: string) {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name] || ICONS['link']!}></path></svg>`;
}

class OptimiumHome extends LitElement {
  static override properties = {
    config: {type: Object, state: true}, time: {type: Object, state: true}, query: {type: String, state: true},
    history: {type: Array, state: true}, historyOpen: {type: Boolean, state: true}, drawerOpen: {type: Boolean, state: true},
    status: {type: String, state: true}, weather: {type: Object, state: true}, weatherLoading: {type: Boolean, state: true},
    soundcloudOpening: {type: Boolean, state: true},
    soundcloudState: {type: Object, state: true},
  };
  private accessor config = readConfig();
  private accessor time = new Date();
  private accessor query = '';
  private accessor history: string[] = [];
  private accessor historyOpen = false;
  private accessor drawerOpen = false;
  private accessor status = '';
  private accessor weather: WeatherData|null = null;
  private accessor weatherLoading = false;
  private accessor soundcloudOpening = false;
  private accessor soundcloudState: SoundcloudState|null = null;
  private soundcloudTimer = 0;
  private soundcloudPolling = false;
  private timer = 0;
  private weatherRequest: AbortController|null = null;
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key === CONFIG_KEY) {
      this.config = readConfig();
      void this.updateWeather();
    }
    if (event.key === HISTORY_KEY) { this.readHistory(); }
  };
  private readonly onVisibility = () => {
    if (!document.hidden) { this.time = new Date(); }
  };
  static override styles = css`
    :host {
      --page: var(--color-new-tab-page-background, #201e26);
      --ink: var(--color-new-tab-page-text, #eeeaf4);
      --accent: var(--color-sys-primary, #c7b8eb);
      --muted: color-mix(in srgb, var(--ink) 68%, var(--page));
      --surface: color-mix(in srgb, var(--page) 90%, var(--ink));
      --line: color-mix(in srgb, var(--ink) 14%, transparent);
      display: block; color: var(--ink); background: var(--page);
      min-height: 100vh; font: 15px/1.5 Roboto, system-ui, sans-serif;
      color-scheme: light dark;
    }
    * { box-sizing: border-box; }
    button, input, select, textarea { font: inherit; }
    button, a, input, select, textarea { -webkit-tap-highlight-color: transparent; }
    button, a { touch-action: manipulation; }
    button, .button { border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; background: var(--surface); color: var(--ink); cursor: pointer; text-decoration: none; }
    button:hover, .button:hover { background: color-mix(in srgb, var(--surface) 88%, var(--ink)); }
    button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
    button:disabled { opacity: .55; cursor: default; }
    svg { width: 20px; height: 20px; flex: none; vertical-align: middle; }
    .icon-button { display: inline-flex; align-items: center; gap: 8px; }
    .quiet { background: transparent; border-color: transparent; }
    .page { min-height: 100vh; display: flex; flex-direction: column; padding: 24px 36px; }
    header { display: flex; gap: 16px; justify-content: space-between; align-items: center; min-height: 46px; }
    .wordmark { font-size: 16px; font-weight: 650; letter-spacing: .01em; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; }
    main { width: 100%; max-width: 1024px; margin: 32px auto; flex: 1; }
    .heading { margin: 0 0 36px; text-align: center; font-size: 16px; font-weight: 550; color: var(--muted); overflow-wrap: anywhere; }
    .hero { min-height: 176px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; margin: 12px auto 28px; }
    .clock-face { max-width: 100%; }
    [data-clock-style='display'] { --clock-font: 'Noto Sans', Roboto, sans-serif; --clock-weight: 900; --clock-tracking: -.02em; }
    [data-clock-style='soft'] { --clock-font: Comfortaa, 'Noto Sans', sans-serif; --clock-weight: 700; --clock-tracking: -.045em; }
    [data-clock-style='modern'] { --clock-font: 'Adwaita Sans', Roboto, sans-serif; --clock-weight: 600; --clock-tracking: -.055em; }
    [data-clock-style='condensed'] { --clock-font: 'Noto Sans Condensed', 'Noto Sans', sans-serif; --clock-weight: 800; --clock-tracking: -.04em; --clock-stretch: condensed; }
    [data-clock-style='mono'] { --clock-font: 'Adwaita Mono', 'Liberation Mono', monospace; --clock-weight: 600; --clock-tracking: -.07em; }
    [data-clock-style='serif'] { --clock-font: 'Noto Serif', Georgia, serif; --clock-weight: 600; --clock-tracking: -.06em; }
    [data-clock-style='light'] { --clock-font: Roboto, system-ui, sans-serif; --clock-weight: 350; --clock-tracking: -.055em; }
    .clock { display: flex; align-items: baseline; justify-content: center; gap: .12em; font-family: var(--clock-font); font-size: clamp(64px, 10vw, 104px); font-weight: var(--clock-weight); font-stretch: var(--clock-stretch, normal); line-height: 1.1; letter-spacing: var(--clock-tracking); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .clock-period { font: 500 .2em/1.2 Roboto, system-ui, sans-serif; letter-spacing: 0; color: var(--muted); }
    .clock-weather .clock { font-size: clamp(72px, 24vw, 160px); }
    .hero-weather { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-top: 12px; font-size: clamp(16px, 3vw, 22px); line-height: 1.4; }
    .hero-weather svg { width: 28px; height: 28px; }
    .hero-weather-temperature { font-variant-numeric: tabular-nums; }
    .hero-weather-city { overflow-wrap: anywhere; max-width: 100%; }
    .hero-weather-divider { width: 4px; height: 4px; border-radius: 50%; background: var(--muted); margin-inline: 6px; }
    .hero-weather .quiet { font-size: 15px; }
    .date, .muted { color: var(--muted); }
    .date { margin-top: 14px; }
    .custom-text, .crossed-google { font-size: clamp(36px, 7vw, 72px); font-weight: 500; letter-spacing: -.035em; overflow-wrap: anywhere; max-width: 100%; }
    .crossed-google { text-decoration: line-through; text-decoration-thickness: 3px; text-decoration-color: var(--accent); }
    .search-area { margin: 0 auto; max-width: var(--search-width, 584px); position: relative; z-index: 2; }
    .search { display: flex; align-items: center; gap: 4px; min-height: 48px; border-radius: 999px; padding: 0 16px 0 4px; border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) var(--opacity, 76%), transparent); }
    .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .search input { background: transparent; color: var(--ink); border: 0; outline: 0; min-width: 0; width: 100%; height: 46px; }
    .search input:focus-visible { outline: none; }
    input::placeholder, textarea::placeholder { color: var(--muted); opacity: 1; }
    .search button { display: grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--muted); }
    .search button:hover { background: var(--surface); color: var(--ink); }
    .search button:focus-visible { outline-offset: 0; }
    .history { position: absolute; top: calc(100% + 8px); left: 0; right: 0; border-radius: 16px; padding: 8px; background: var(--surface); border: 1px solid var(--line); box-shadow: 0 12px 30px #0002; }
    .history p { margin: 6px 12px; font-size: 12px; color: var(--muted); }
    .history button { display: flex; align-items: center; gap: 12px; border: 0; background: transparent; text-align: start; width: 100%; overflow-wrap: anywhere; }
    .history button:hover { background: color-mix(in srgb, var(--surface) 85%, var(--ink)); }
    .shortcuts { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin: 28px auto 36px; max-width: 720px; }
    .shortcut { width: 104px; padding: 12px 8px; border-radius: 16px; text-align: center; color: var(--ink); text-decoration: none; font-size: 13px; background: transparent; border: 0; }
    .shortcut:hover { background: var(--surface); }
    .shortcut svg { display: block; margin: 0 auto 10px; width: 24px; height: 24px; }
    .shortcut span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .widgets { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 20px; margin: 40px auto 0; max-width: 820px; }
    .widget { background: color-mix(in srgb, var(--surface) var(--opacity, 76%), transparent); border: 1px solid var(--line); border-radius: var(--radius, 24px); padding: 22px; min-width: 0; }
    .widget h2 { margin: 0 0 16px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
    .weather-value { font-size: 42px; line-height: 1.2; font-variant-numeric: tabular-nums; }
    .widget p { margin: 8px 0; }
    .widget small, small { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .mini-player { display: flex; align-items: center; gap: 12px; }
    .mini-art { width: 56px; height: 56px; flex: none; border-radius: 10px; object-fit: cover; background: var(--surface); }
    .mini-info { min-width: 0; flex: 1; }
    .mini-info strong, .mini-info span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mini-info span { font-size: 13px; color: var(--muted); }
    .mini-controls { display: flex; align-items: center; gap: 2px; }
    .mini-controls button { width: 38px; height: 38px; border: 0; padding: 8px; background: transparent; border-radius: 50%; }
    .mini-controls button:hover:not(:disabled) { background: var(--surface); }
    .widget a { color: var(--muted); }
    iframe { width: 100%; height: 166px; border: 0; border-radius: 12px; background: transparent; }
    footer { display: flex; justify-content: center; flex-wrap: wrap; gap: 24px; padding: 16px; }
    footer a { color: var(--muted); text-decoration: none; font-size: 13px; }
    footer a:hover { color: var(--ink); }
    .compact main { margin-top: 12px; }
    .compact .hero { min-height: 128px; margin-bottom: 20px; }
    .compact .heading { margin-bottom: 16px; }
    .compact .clock { font-size: 64px; }
    .compact .clock-weather .clock { font-size: clamp(64px, 12vw, 104px); }
    dialog { margin: 0 0 0 auto; position: fixed; height: 100dvh; max-height: 100dvh; width: min(480px, 100%); max-width: 100%; border: 0; border-left: 1px solid var(--line); padding: 0; color: var(--ink); background: var(--page); }
    dialog::backdrop { background: #0005; }
    .drawer-header { position: sticky; top: 0; z-index: 1; padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--page); }
    .drawer-header h1 { font-size: 19px; margin: 0; }
    .drawer-body { padding: 24px; }
    .drawer-body h2 { font-size: 15px; margin: 28px 0 16px; }
    .drawer-body h2:first-child { margin-top: 0; }
    #weather-settings { scroll-margin-top: 104px; }
    .field { display: flex; flex-direction: column; gap: 8px; margin: 16px 0; }
    .field span { font-size: 13px; color: var(--muted); }
    .clock-styles { border: 0; padding: 0; margin: 20px 0; }
    .clock-styles legend { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
    .clock-style-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .clock-style { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px; }
    .clock-style[aria-pressed='true'] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
    .clock-style-preview { font-family: var(--clock-font); font-size: 30px; font-weight: var(--clock-weight); font-stretch: var(--clock-stretch, normal); line-height: 1.3; letter-spacing: var(--clock-tracking); font-variant-numeric: tabular-nums; }
    .clock-style-label { font-size: 12px; }
    .field input:not([type=range]), .field select, textarea { width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); }
    .check { display: flex; gap: 12px; align-items: center; margin: 16px 0; }
    input[type=checkbox], input[type=range] { accent-color: var(--accent); }
    input[type=checkbox] { width: 18px; height: 18px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .saved-shortcut { display: flex; gap: 8px; align-items: center; padding: 8px 0; }
    .saved-shortcut span { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .notice { font-size: 13px; color: var(--muted); margin: 12px 0; }
    .status { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); border: 1px solid var(--line); border-radius: 12px; padding: 12px 18px; max-width: min(600px, 90vw); background: var(--surface); z-index: 5; }
    details { border-top: 1px solid var(--line); padding-top: 18px; margin-top: 24px; }
    summary { cursor: pointer; }
    @media (max-width: 600px) {
      .page { padding: 16px; } header { align-items: flex-start; }
      nav .label { display: none; } main { margin-top: 24px; }
      .hero { min-height: 140px; } .widget { padding: 18px; }
      .heading { margin-bottom: 20px; }
    }
    @media (prefers-reduced-motion: no-preference) {
      button, a { transition: background-color 120ms, color 120ms; }
    }
  `;
  override connectedCallback() {
    super.connectedCallback();
    this.readHistory();
    ColorChangeUpdater.forDocument().start();
    this.timer = window.setInterval(() => {
      if (!document.hidden) { this.time = new Date(); }
    }, 15000);
    this.soundcloudTimer = window.setInterval(() => { void this.refreshSoundcloud(); }, 2000);
    void this.refreshSoundcloud();
    window.addEventListener('storage', this.onStorage);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.updateWeather();
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.clearInterval(this.timer);
    window.clearInterval(this.soundcloudTimer);
    this.weatherRequest?.abort();
    window.removeEventListener('storage', this.onStorage);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
  private readHistory() {
    try {
      const data: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      this.history = Array.isArray(data) ? data.filter((v): v is string => typeof v === 'string').slice(0, 50).map(v => v.slice(0, 300)) : [];
    } catch { this.history = []; }
  }
  private save(patch: Partial<HomeConfig>) {
    this.config = normalizeConfig({...this.config, ...patch});
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config)); }
    catch { this.status = 'Не удалось сохранить настройки: хранилище недоступно.'; }
  }
  private setValue(key: 'heading'|'customText'|'searchPlaceholder'|'city', event: Event) {
    this.save({[key]: (event.target as HTMLInputElement).value});
    if (key === 'city' && this.config.weatherEnabled) { void this.updateWeather(true); }
  }
  private setCheck(key: 'showHeading'|'showDate'|'clock24'|'compact'|'showHistory'|'weatherEnabled'|'soundcloudEnabled'|'soundcloudMiniEnabled', event: Event) {
    this.save({[key]: (event.target as HTMLInputElement).checked});
    if (key === 'weatherEnabled') { void this.updateWeather(); }
  }
  private async openDrawer() {
    this.historyOpen = false;
    this.drawerOpen = true;
    await this.updateComplete;
    const dialog = this.renderRoot.querySelector('dialog');
    if (dialog && !dialog.open) { dialog.showModal(); }
  }
  private closeDrawer() {
    this.renderRoot.querySelector('dialog')?.close();
    this.drawerOpen = false;
  }
  private async openWeatherSettings() {
    await this.openDrawer();
    this.renderRoot.querySelector('#weather-settings')?.scrollIntoView({block: 'start'});
    this.renderRoot.querySelector<HTMLInputElement>('#weather-city')?.focus({preventScroll: true});
  }
  private navigate(query: string) {
    const value = query.trim().slice(0, 2048);
    if (!value) { return; }
    const looksLikeUrl = /^(https?:\/\/|localhost(?::\d+)?(?:\/|$)|[^\s.]+\.[a-z]{2,}(?::\d+)?(?:\/|$))/i.test(value);
    if (looksLikeUrl) {
      const url = safeUrl(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (url) { window.location.href = url; return; }
    }
    this.history = [value, ...this.history.filter(item => item !== value)].slice(0, 50);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history)); } catch {}
    const template = loadTimeData.getString('optimiumSearchUrl');
    const url = safeUrl(template.replaceAll('OPTIMIUMQUERY', encodeURIComponent(value)));
    if (url) { window.location.href = url; }
    else { this.status = 'Выбери поисковую систему в настройках Optimium.'; }
  }
  private async updateWeather(force = false) {
    this.weatherRequest?.abort();
    this.weatherLoading = false;
    this.weather = null;
    if (!this.config.weatherEnabled || !this.config.city) { return; }
    const city = this.config.city;
    try {
      const cached = JSON.parse(localStorage.getItem(WEATHER_KEY) || 'null') as WeatherData|null;
      if (!force && cached?.city === city && Number.isFinite(cached.temperature) && Number.isFinite(cached.code) && Date.now() - cached.time < 30 * 60 * 1000) {
        this.weather = cached; return;
      }
    } catch {}
    const controller = new AbortController();
    this.weatherRequest = controller;
    this.weatherLoading = true;
    try {
      const weather = await this.requestWeather(city, controller.signal);
      if (this.config.city !== city || controller.signal.aborted) { return; }
      this.weather = weather;
      try { localStorage.setItem(WEATHER_KEY, JSON.stringify(weather)); } catch {}
    } catch (error) {
      if (!controller.signal.aborted) { this.status = error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Погода не загрузилась. Повтори позже.'; }
    } finally {
      if (this.weatherRequest === controller) { this.weatherLoading = false; }
    }
  }
  private requestWeather(city: string, signal: AbortSignal): Promise<WeatherData> {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.title = 'Загрузка погоды';
      frame.setAttribute('aria-hidden', 'true');
      frame.referrerPolicy = 'no-referrer';
      const id = crypto.randomUUID();
      const origin = 'chrome-untrusted://new-tab-page';
      let timer = 0;
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener('message', receive);
        signal.removeEventListener('abort', cancel);
        frame.remove();
      };
      const cancel = () => {
        cleanup();
        reject(new DOMException('Weather request cancelled', 'AbortError'));
      };
      const receive = (event: MessageEvent) => {
        const value = event.data;
        if (event.origin !== origin || event.source !== frame.contentWindow ||
            !value || value.type !== 'optimium-weather' || value.id !== id ||
            value.city !== city) {
          return;
        }
        cleanup();
        const weather = value.weather;
        if (weather && typeof weather.label === 'string' &&
            typeof weather.temperature === 'number' &&
            Number.isFinite(weather.temperature) &&
            typeof weather.code === 'number' && Number.isFinite(weather.code)) {
          resolve({city, label: weather.label.slice(0, 100),
            temperature: weather.temperature, code: weather.code, time: Date.now()});
        } else {
          reject(new Error(typeof value.error === 'string' ?
              value.error.slice(0, 180) : 'Погода временно недоступна.'));
        }
      };
      window.addEventListener('message', receive);
      signal.addEventListener('abort', cancel, {once: true});
      timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('Погода не загрузилась. Повтори позже.'));
      }, 15000);
      if (signal.aborted) { cancel(); return; }
      frame.src = `${origin}/optimium_weather.html#${
          new URLSearchParams({city, id}).toString()}`;
      this.renderRoot.appendChild(frame);
    });
  }
  private weatherDescription(code: number): string {
    if (code === 0) { return 'Ясно'; }
    if (code <= 3) { return 'Облачно'; }
    if (code <= 48) { return 'Туман'; }
    if (code <= 67) { return 'Дождь'; }
    if (code <= 77) { return 'Снег'; }
    if (code <= 82) { return 'Ливень'; }
    if (code <= 86) { return 'Снегопад'; }
    return 'Гроза';
  }
  private weatherIcon(code: number): string {
    if (code === 0) { return 'sun'; }
    if (code <= 2) { return 'cloud-sun'; }
    if (code === 3) { return 'cloud'; }
    if (code <= 48) { return 'fog'; }
    if (code >= 95) { return 'storm'; }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) { return 'snow'; }
    return 'rain';
  }
  private heroWeather() {
    if (this.weatherLoading) {
      return html`<div class="hero-weather muted" role="status">Загрузка погоды…</div>`;
    }
    if (!this.config.weatherEnabled || !this.config.city) {
      return html`<div class="hero-weather"><button class="quiet icon-button" @click=${() => this.openWeatherSettings()}>${icon('cloud')}Добавить погоду</button></div>`;
    }
    if (!this.weather) {
      return html`<div class="hero-weather"><button class="quiet icon-button" @click=${() => this.updateWeather(true)}>${icon('cloud')}Погода недоступна · повторить</button></div>`;
    }
    const weather = this.weather;
    const description = this.weatherDescription(weather.code);
    const temperature = `${Math.round(weather.temperature)}°C`;
    return html`<div class="hero-weather" role="group" aria-label=${`${description}, ${temperature}, ${weather.label}`}>
      ${icon(this.weatherIcon(weather.code))}<span class="hero-weather-temperature">${temperature}</span>
      <span class="hero-weather-divider" aria-hidden="true"></span><span class="hero-weather-city">${weather.label}</span>
    </div>`;
  }
  private clockContent(combined = false) {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit', minute: '2-digit', hour12: !this.config.clock24,
    };
    const parts = new Intl.DateTimeFormat(undefined, options).formatToParts(this.time);
    const digits = parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim();
    const period = parts.find(part => part.type === 'dayPeriod')?.value;
    const style = combined ? this.config.clockWeatherStyle : this.config.clockStyle;
    return html`<div class=${combined ? 'clock-face clock-weather' : 'clock-face'} data-clock-style=${style}>
      <time class="clock" datetime=${this.time.toISOString()}><span>${digits}</span>${period ? html`<span class="clock-period">${period}</span>` : nothing}</time>
      ${combined ? this.heroWeather() : nothing}
      ${this.config.showDate ? html`<div class="date">${this.time.toLocaleDateString([], {weekday: 'long', day: 'numeric', month: 'long'})}</div>` : nothing}
    </div>`;
  }
  private weatherContent() {
    if (this.weatherLoading) { return html`<p class="muted">Загрузка погоды…</p>`; }
    if (!this.weather) {
      return html`<p class="muted">${this.config.city ? 'Погода пока недоступна' : 'Выбери город в настройках страницы'}</p><button @click=${() => this.openDrawer()}>Настроить погоду</button>`;
    }
    return html`<div class="weather-value">${Math.round(this.weather.temperature)}°</div><p>${this.weather.label} · ${this.weatherDescription(this.weather.code)}</p><small>Обновлено ${new Date(this.weather.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} · <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a></small>`;
  }
  private hero() {
    switch (this.config.hero) {
      case 'clock': return this.clockContent();
      case 'clock-weather': return this.clockContent(true);
      case 'google': return html`<div class="crossed-google">Google</div>`;
      case 'text': return html`<div class="custom-text">${this.config.customText}</div>`;
      case 'weather': return this.weatherContent();
      default: return nothing;
    }
  }
  private playerUrl(): string {
    const url = new URL('https://w.soundcloud.com/player/');
    url.search = new URLSearchParams({url: this.config.soundcloudUrl, auto_play: 'false', hide_related: 'true', show_comments: 'false', show_artwork: 'false', show_user: 'true', show_reposts: 'false', show_teaser: 'false', visual: 'false', color: '#ac9dcf'}).toString();
    return url.href;
  }
  private async openSoundcloudPanel() {
    if (this.soundcloudOpening) { return; }
    this.soundcloudOpening = true;
    try {
      const opened = await sendWithPromise<boolean>('openOptimiumSoundCloud');
      if (opened && this.drawerOpen) { this.closeDrawer(); }
      if (!opened) { this.status = 'Не удалось открыть SoundCloud. Попробуй ещё раз.'; }
    } catch (error) {
      this.status = typeof error === 'string' ? error.slice(0, 180) :
          'Не удалось открыть SoundCloud. Попробуй ещё раз.';
    } finally {
      this.soundcloudOpening = false;
    }
  }
  private async refreshSoundcloud() {
    if (!this.config.soundcloudMiniEnabled || document.hidden || this.soundcloudPolling) { return; }
    this.soundcloudPolling = true;
    try {
      this.soundcloudState = await sendWithPromise<SoundcloudState>('getOptimiumSoundCloudState');
    } catch {
      this.soundcloudState = null;
    } finally {
      this.soundcloudPolling = false;
    }
  }
  private async controlSoundcloud(action: 'previous'|'play'|'pause'|'next') {
    try {
      const handled = await sendWithPromise<boolean>('controlOptimiumSoundCloud', action);
      if (!handled) { this.status = 'Это действие сейчас недоступно в SoundCloud.'; }
      await this.refreshSoundcloud();
    } catch {
      this.status = 'Не удалось управлять воспроизведением SoundCloud.';
    }
  }
  private soundcloudMiniPlayer() {
    const state = this.soundcloudState;
    return html`<article class="widget" aria-label="Мини-плеер SoundCloud">
      <div class="mini-player">
        ${state?.artwork ? html`<img class="mini-art" src=${state.artwork} alt="">` : nothing}
        <div class="mini-info"><strong>${state?.title || 'SoundCloud'}</strong><span>${state?.artist || (state?.available ? 'Выбери музыку в медиатеке' : 'Открой медиатеку и включи музыку')}</span></div>
        <div class="mini-controls">
          <button aria-label="Предыдущий трек" ?disabled=${!state?.canPrevious} @click=${() => this.controlSoundcloud('previous')}>${icon('previous')}</button>
          <button aria-label=${state?.playing ? 'Пауза' : 'Воспроизвести'} ?disabled=${state?.playing ? !state.canPause : !state?.canPlay} @click=${() => this.controlSoundcloud(state?.playing ? 'pause' : 'play')}>${icon(state?.playing ? 'pause' : 'play')}</button>
          <button aria-label="Следующий трек" ?disabled=${!state?.canNext} @click=${() => this.controlSoundcloud('next')}>${icon('next')}</button>
        </div>
      </div>
      <button class="quiet" @click=${() => this.openSoundcloudPanel()}>Открыть медиатеку</button>
    </article>`;
  }
  private addShortcut(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const raw = String(data.get('url') || '').trim();
    const url = safeUrl(raw.includes('://') ? raw : `https://${raw}`);
    const name = String(data.get('name') || '').trim();
    if (!url || !name) { this.status = 'Укажи название и адрес сайта с http:// или https://.'; return; }
    this.save({shortcuts: [...this.config.shortcuts, {name, url, icon: String(data.get('icon') || 'link')}]});
    form.reset();
  }
  private exportConfig() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.config, null, 2)], {type: 'application/json'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'optimium-home.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private async importConfig(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) { return; }
    try {
      if (file.size > 64 * 1024) { throw new Error('Файл настроек должен быть меньше 64 КБ.'); }
      const config = normalizeConfig(JSON.parse(await file.text()));
      // Importing appearance is not consent to contact third-party services.
      config.weatherEnabled = false;
      config.soundcloudEnabled = false;
      this.save(config);
      this.status = 'Настройки импортированы. Сетевые виджеты можно включить отдельно.';
      void this.updateWeather();
    } catch (error) { this.status = error instanceof Error ? error.message : 'Не удалось импортировать настройки.'; }
    input.value = '';
  }
  private clearHistory() {
    this.history = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    this.status = 'История поиска этой страницы очищена.';
  }
  private check(label: string, key: 'showHeading'|'showDate'|'clock24'|'compact'|'showHistory'|'weatherEnabled'|'soundcloudEnabled'|'soundcloudMiniEnabled') {
    return html`<label class="check"><input type="checkbox" .checked=${this.config[key]} @change=${(e: Event) => this.setCheck(key, e)}>${label}</label>`;
  }
  private range(label: string, key: 'radius'|'searchWidth'|'surfaceOpacity', min: number, max: number, unit: string) {
    return html`<label class="field"><span>${label} · ${this.config[key]}${unit}</span><input type="range" min=${min} max=${max} .value=${String(this.config[key])} @input=${(e: Event) => this.save({[key]: Number((e.target as HTMLInputElement).value)})}></label>`;
  }
  private clockStyles() {
    const key = this.config.hero === 'clock-weather' ? 'clockWeatherStyle' : 'clockStyle';
    return html`<fieldset class="clock-styles"><legend>Стиль цифр</legend>
      <div class="clock-style-options">${CLOCK_STYLES.map(style => html`
        <button type="button" class="clock-style" data-clock-style=${style.id}
            aria-pressed=${this.config[key] === style.id}
            @click=${() => this.save({[key]: style.id})}>
          <span class="clock-style-preview" aria-hidden="true">22:47</span>
          <span class="clock-style-label">${style.label}</span>
        </button>`)}</div>
    </fieldset>`;
  }
  private drawer() {
    if (!this.drawerOpen) { return nothing; }
    return html`<dialog @close=${() => { this.drawerOpen = false; }} @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) { this.closeDrawer(); } }}>
      <div class="drawer-header"><h1>Настроить новую вкладку</h1><button class="quiet" aria-label="Закрыть" @click=${() => this.closeDrawer()}>${icon('close')}</button></div>
      <div class="drawer-body">
        <h2>Оформление</h2><a class="button icon-button" href="chrome://settings/appearance">${icon('palette')}Темы Optimium</a>
        <p class="notice">Страница использует цвета темы браузера. Изменения ниже сохраняются сразу.</p>
        <label class="field"><span>Главный виджет</span><select .value=${this.config.hero} @change=${(e: Event) => this.save({hero: (e.target as HTMLSelectElement).value as Hero})}><option value="clock">Часы</option><option value="clock-weather">Часы + погода</option><option value="google">Зачёркнутый Google</option><option value="weather">Погода</option><option value="text">Свой текст</option><option value="none">Без виджета</option></select></label>
        ${this.config.hero === 'text' ? html`<label class="field"><span>Текст виджета</span><input maxlength="120" .value=${this.config.customText} @change=${(e: Event) => this.setValue('customText', e)}></label>` : nothing}
        ${this.config.hero === 'clock' || this.config.hero === 'clock-weather' ? html`${this.clockStyles()}${this.check('24-часовой формат', 'clock24')}${this.check('Показывать дату', 'showDate')}` : nothing}
        ${this.check('Показывать надпись сверху', 'showHeading')}
        ${this.config.showHeading ? html`<label class="field"><span>Надпись</span><input maxlength="160" .value=${this.config.heading} @change=${(e: Event) => this.setValue('heading', e)}></label>` : nothing}
        ${this.check('Компактное расположение', 'compact')}
        ${this.range('Скругление панелей', 'radius', 0, 36, ' px')}
        ${this.range('Плотность фона панелей', 'surfaceOpacity', 20, 100, '%')}
        <h2>Поиск</h2>
        <label class="field"><span>Подсказка в строке</span><input maxlength="80" .value=${this.config.searchPlaceholder} @change=${(e: Event) => this.setValue('searchPlaceholder', e)}></label>
        ${this.range('Ширина поиска', 'searchWidth', 360, 900, ' px')}
        ${this.check('Показывать локальную историю запросов', 'showHistory')}
        <p class="notice">Только запросы с этой страницы. Популярных запросов и рекомендаций нет.</p>
        <div class="row"><button @click=${() => this.clearHistory()}>Очистить историю</button><a class="button" href="chrome://settings/search">Поисковая система</a></div>
        <h2>Ярлыки</h2>
        ${this.config.shortcuts.map((s, index) => html`<div class="saved-shortcut">${icon(s.icon)}<span>${s.name}</span><button class="quiet" aria-label=${`Удалить ${s.name}`} @click=${() => this.save({shortcuts: this.config.shortcuts.filter((_, i) => i !== index)})}>${icon('close')}</button></div>`)}
        ${this.config.shortcuts.length < 12 ? html`<form @submit=${(e: SubmitEvent) => this.addShortcut(e)}><label class="field"><span>Название</span><input name="name" required maxlength="40" placeholder="Например, YouTube"></label><label class="field"><span>Адрес</span><input name="url" required maxlength="2048" placeholder="https://youtube.com"></label><label class="field"><span>Иконка</span><select name="icon"><option value="globe">Сайт</option><option value="video">Видео</option><option value="music">Музыка</option><option value="code">Код</option><option value="book">Чтение</option><option value="link">Ссылка</option></select></label><button type="submit" class="icon-button">${icon('plus')}Добавить ярлык</button></form>` : nothing}
        <h2 id="weather-settings">Погода</h2>
        <label class="field"><span>Город</span><input id="weather-city" maxlength="100" .value=${this.config.city} @change=${(e: Event) => this.setValue('city', e)} placeholder="Например, Екатеринбург"></label>
        ${this.check('Разрешить загрузку погоды Open-Meteo', 'weatherEnabled')}
        <p class="notice">В Open-Meteo отправляется название выбранного города. Геолокация устройства не запрашивается.</p>
        <button ?disabled=${!this.config.weatherEnabled || !this.config.city || this.weatherLoading} @click=${() => this.updateWeather(true)}>Обновить погоду</button>
        <h2>SoundCloud</h2>
        <button class="icon-button" ?disabled=${this.soundcloudOpening} @click=${() => this.openSoundcloudPanel()}>${icon('music')}Открыть медиатеку</button>
        <p class="notice">Аккаунт и сохранённая музыка — в боковой панели SoundCloud. Вход выполняется на самом SoundCloud.</p>
        ${this.check('Мини-плеер медиатеки на главной', 'soundcloudMiniEnabled')}
        <p class="notice">Управление зависит от возможностей, которые SoundCloud предоставляет текущему треку.</p>
        <details><summary>Плеер трека на новой вкладке</summary>
        <label class="field"><span>Ссылка на трек или плейлист SoundCloud</span><input type="url" maxlength="2048" .value=${this.config.soundcloudUrl} placeholder="https://soundcloud.com/…" @change=${(e: Event) => {
          const value = (e.target as HTMLInputElement).value.trim();
          if (value && !soundcloudUrl(value)) { this.status = 'Нужна HTTPS-ссылка soundcloud.com на трек или плейлист.'; return; }
          this.save({soundcloudUrl: value});
        }}></label>
        ${this.check('Загружать плеер SoundCloud', 'soundcloudEnabled')}
        <p class="notice">Плеер обращается к SoundCloud, когда включён. Автозапуск выключен. Прозрачность применяется к панели; оформление самого плеера задаёт SoundCloud.</p>
        </details>
        <details><summary>Перенос и сброс настроек</summary><p class="notice">Файл JSON описывает виджеты, ярлыки и расположение. Произвольный код не выполняется.</p><div class="row"><button class="icon-button" @click=${() => this.exportConfig()}>${icon('download')}Экспорт</button><button @click=${() => { this.save(defaults()); void this.updateWeather(); }}>Сбросить оформление</button></div><label class="field"><span>Импорт optimium-home.json</span><input type="file" accept=".json,application/json" @change=${(e: Event) => this.importConfig(e)}></label></details>
      </div>
    </dialog>`;
  }
  override render() {
    const matches = this.history.filter(value => value.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())).slice(0, 6);
    const style = `--radius:${this.config.radius}px;--search-width:${this.config.searchWidth}px;--opacity:${this.config.surfaceOpacity}%`;
    const showWeatherWidget = this.config.weatherEnabled && this.config.hero !== 'weather' && this.config.hero !== 'clock-weather';
    return html`<div class=${this.config.compact ? 'page compact' : 'page'} style=${style} @click=${(e: MouseEvent) => {
      if (!(e.target as Element).closest('.search-area')) { this.historyOpen = false; }
    }}>
      <header><span class="wordmark">Optimium</span><nav><button class="quiet icon-button" ?disabled=${this.soundcloudOpening} @click=${() => this.openSoundcloudPanel()} aria-label="Открыть медиатеку SoundCloud">${icon('music')}<span class="label">SoundCloud</span></button><a class="button quiet icon-button" href="chrome://settings/appearance" aria-label="Темы Optimium">${icon('palette')}<span class="label">Темы</span></a><button class="quiet icon-button" @click=${() => this.openDrawer()} aria-label="Настроить новую вкладку">${icon('settings')}<span class="label">Настроить</span></button></nav></header>
      <main>
        ${this.config.showHeading && this.config.heading ? html`<p class="heading">${this.config.heading}</p>` : nothing}
        ${this.config.hero !== 'none' ? html`<section class="hero" aria-label="Главный виджет">${this.hero()}</section>` : nothing}
        <div class="search-area">
          <form class="search" role="search" @submit=${(e: SubmitEvent) => { e.preventDefault(); this.navigate(this.query); }}>
            <button type="submit" aria-label="Искать">${icon('search')}</button><input aria-label="Поиск или адрес сайта" enterkeyhint="search" autocomplete="off" spellcheck="false" .value=${this.query} placeholder=${this.config.searchPlaceholder} @focus=${() => { this.historyOpen = true; }} @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value; this.historyOpen = true; }} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') { this.historyOpen = false; } }}>
          </form>
          ${this.historyOpen && this.config.showHistory && matches.length ? html`<div class="history"><p>История поиска на этой странице</p>${matches.map(value => html`<button @click=${() => this.navigate(value)}>${icon('history')}<span>${value}</span></button>`)}</div>` : nothing}
        </div>
        <section class="shortcuts" aria-label="Ярлыки">${this.config.shortcuts.map(s => html`<a class="shortcut" href=${s.url}>${icon(s.icon)}<span>${s.name}</span></a>`)}<button class="shortcut" @click=${() => this.openDrawer()}>${icon('plus')}<span>Добавить</span></button></section>
        ${showWeatherWidget || (this.config.soundcloudMiniEnabled && this.soundcloudState?.available) || (this.config.soundcloudEnabled && this.config.soundcloudUrl) ? html`<section class="widgets">
          ${showWeatherWidget ? html`<article class="widget"><h2>${icon('cloud')}Погода</h2>${this.weatherContent()}</article>` : nothing}
          ${this.config.soundcloudMiniEnabled && this.soundcloudState?.available ? this.soundcloudMiniPlayer() : nothing}
          ${this.config.soundcloudEnabled && this.config.soundcloudUrl ? html`<article class="widget"><h2>${icon('music')}SoundCloud</h2><iframe title="Плеер SoundCloud" src=${this.playerUrl()} loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></article>` : nothing}
        </section>` : nothing}
      </main>
      <footer><a href="chrome://history">История</a><a href="chrome://bookmarks">Закладки</a><a href="chrome://downloads">Загрузки</a><a href="chrome://settings/performance">Экономия памяти</a></footer>
      ${this.drawer()}
      ${this.status ? html`<div class="status" role="status">${this.status}<button class="quiet" aria-label="Закрыть уведомление" @click=${() => { this.status = ''; }}>${icon('close')}</button></div>` : nothing}
    </div>`;
  }
}
customElements.define('optimium-home', OptimiumHome);
