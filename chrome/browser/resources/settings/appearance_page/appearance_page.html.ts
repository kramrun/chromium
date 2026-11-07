// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {html} from '//resources/lit/v3_0/lit.rollup.js';

import {RestartType} from '../relaunch_mixin_lit.js';

import type {SettingsAppearancePageElement} from './appearance_page.js';

export function getHtml(this: SettingsAppearancePageElement) {
  return html`<!--_html_template_start_-->
<settings-section page-title="$i18n{appearancePageTitle}">
  <div route-path="default">
    <section class="optimium-theme-studio"
        ?hidden="${!this.pageVisibility_.setTheme}" aria-label="Темы Optimium">
      <div class="design-heading">
        <div><h2>Темы Optimium</h2>
          <p>Выбери палитру — она применяется одним нажатием.</p></div>
      </div>
      <div class="design-presets" role="group" aria-label="Готовые темы">
        ${this.designThemePresets_.map(preset => html`
          <button class="design-preset" data-name="${preset.name}"
              ?disabled="${this.designThemeBusy_}"
              aria-pressed="${this.designThemeActive_ === preset.name}"
              @click="${this.onDesignThemePresetClick_}">
            <svg viewBox="0 0 140 68" aria-hidden="true">
              <rect width="140" height="68" rx="8" fill="${preset.colors['frame']}"></rect>
              <rect x="9" y="9" width="52" height="12" rx="4"
                  fill="${preset.colors['toolbar']}"></rect>
              <rect y="21" width="140" height="12" fill="${preset.colors['toolbar']}"></rect>
              <path d="M0 33h140v27q0 8-8 8H8q-8 0-8-8z"
                  fill="${preset.colors['ntp_background']}"></path>
              <rect x="34" y="44" width="72" height="8" rx="4"
                  fill="${preset.colors['toolbar_button_icon']}" opacity=".65"></rect>
            </svg>
            <span>${preset.name}</span>
          </button>
        `)}
      </div>
      <label class="design-option-row">
        <div><span>Применять цвета к поиску Google</span>
          <p>Цвета страницы поиска следуют выбранной теме.</p></div>
        <input type="checkbox" data-option="website_theme_enabled"
            ?disabled="${this.designAppearanceBusy_}"
            .checked="${!!this.designAppearanceOptions_['website_theme_enabled']}"
            @change="${this.onDesignAppearanceOptionChange_}">
      </label>
<if expr="is_linux">
      <div class="design-options" aria-label="Панели и вкладки">
        <label class="design-option-row">
          <div><span>Прозрачность панелей</span>
            <p>Wayland / Niri. Текст и значки остаются непрозрачными.</p></div>
          <select class="md-select" data-option="panel_opacity"
              ?disabled="${this.designAppearanceBusy_}"
              @change="${this.onDesignAppearanceOptionChange_}">
            ${[{value: 100, label: 'Выключена'}, {value: 85, label: 'Слабая · 15%'},
              {value: 70, label: 'Средняя · 30%'}, {value: 50, label: 'Сильная · 50%'}].map(option => html`
              <option value="${option.value}"
                  ?selected="${this.designAppearanceOptions_['panel_opacity'] === option.value}">${option.label}</option>
            `)}
          </select>
        </label>
        <label class="design-option-row">
          <span>Вид верхних вкладок</span>
          <select class="md-select" data-option="tab_style"
              ?disabled="${this.designAppearanceBusy_}"
              @change="${this.onDesignAppearanceOptionChange_}">
            ${[{value: 'rounded', label: 'Мягкие'}, {value: 'flat', label: 'Прямые'},
              {value: 'compact', label: 'Умеренные углы'}].map(option => html`
              <option value="${option.value}"
                  ?selected="${this.designAppearanceOptions_['tab_style'] === option.value}">${option.label}</option>
            `)}
          </select>
        </label>
        <label class="design-option-row">
          <span>Оттенок активной вкладки</span>
          <select class="md-select" data-option="tab_tint"
              ?disabled="${this.designAppearanceBusy_}"
              @change="${this.onDesignAppearanceOptionChange_}">
            ${[{value: 'none', label: 'Из темы'}, {value: 'purple', label: 'Фиолетовый'},
              {value: 'blue', label: 'Синий'}, {value: 'turquoise', label: 'Бирюзовый'},
              {value: 'pink', label: 'Розовый'}].map(option => html`
              <option value="${option.value}"
                  ?selected="${this.designAppearanceOptions_['tab_tint'] === option.value}">${option.label}</option>
            `)}
          </select>
        </label>
        <label class="design-option-row">
          <div><span>Плавное переливание активной вкладки</span>
            <p>Работает с выбранным оттенком. Для экономии ресурсов можно выключить.</p></div>
          <input type="checkbox" data-option="tab_animation"
              ?disabled="${this.designAppearanceBusy_}"
              .checked="${!!this.designAppearanceOptions_['tab_animation']}"
              @change="${this.onDesignAppearanceOptionChange_}">
        </label>
        ${this.designRestartRequired_ ? html`
          <div class="design-restart">
            <span>Для прозрачности нужно перезапустить браузер.</span>
            <cr-button @click="${this.onDesignRestartClick_}">Перезапустить</cr-button>
          </div>
        ` : ''}
      </div>
</if>
      <p class="design-status" role="status" aria-live="polite">${this.designThemeStatus_}</p>
    <details id="designThemeEditor">
      <summary>Своя палитра · импорт и экспорт</summary>
      <div class="design-theme-editor">
        <p>Шесть цветов интерфейса. Применяются сразу, без установки расширений.</p>
        <label for="designThemeName">Название темы</label>
        <input id="designThemeName" maxlength="45"
            .value="${this.designThemeName_}"
            @input="${this.onDesignThemeNameInput_}">
        <div class="design-colors">
          ${this.designThemeFields_.map(field => html`
            <label class="design-color-row">
              <span>${field.label}</span>
              <input type="color" data-key="${field.key}"
                  .value="${this.designThemeColors_[field.key]}"
                  @input="${this.onDesignThemeColorInput_}">
            </label>
          `)}
        </div>
        <p>Предпросмотр</p>
        <svg class="design-preview" viewBox="0 0 400 180" role="img"
            aria-label="Предпросмотр темы">
          <rect width="400" height="180" rx="12"
              fill="${this.designThemeColors_['ntp_background']}"></rect>
          <path d="M 0 12 Q 0 0 12 0 H 388 Q 400 0 400 12 V 32 H 0 Z"
              fill="${this.designThemeColors_['frame']}"></path>
          <path d="M 10 32 V 18 Q 10 10 18 10 H 120 Q 128 10 128 18 V 32 Z"
              fill="${this.designThemeColors_['toolbar']}"></path>
          <rect y="32" width="400" height="35"
              fill="${this.designThemeColors_['toolbar']}"></rect>
          <text x="20" y="25" font-size="10"
              fill="${this.designThemeColors_['tab_text']}">Новая вкладка</text>
          <g fill="none" stroke="${this.designThemeColors_['toolbar_button_icon']}"
              stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="m24 43-6 6 6 6 M42 43l6 6-6 6 M69 43a7 7 0 1 0 4 11 M69 39v7h7"></path>
          </g>
          <text x="200" y="126" text-anchor="middle" font-size="18"
              fill="${this.designThemeColors_['ntp_text']}">Новая вкладка</text>
        </svg>
        <label class="design-color-row">
          <span>Тёмные меню и настройки</span>
          <input type="checkbox" .checked="${this.designThemeDark_}"
              @change="${this.onDesignThemeDarkChange_}">
        </label>
        <div class="design-actions">
          <cr-button class="action-button" ?disabled="${this.designThemeBusy_}"
              @click="${this.onDesignThemeApplyClick_}">Применить</cr-button>
        </div>
        <div class="design-actions">
          <label class="design-import">Импорт темы (.json)
            <input type="file" accept=".json,application/json"
                @change="${this.onDesignThemeImportChange_}">
          </label>
          <cr-button @click="${this.onDesignThemeExportClick_}">
            Сохранить в файл
          </cr-button>
        </div>
        <p>Импорт поддерживает цвета manifest.json. После загрузки нажми «Применить».</p>
      </div>
    </details>
    </section>
    <div class="settings-row first" id="themeRow"
        ?hidden="${!this.pageVisibility_.setTheme}">
      <cr-link-row id="openTheme" class="first"
          ?hidden="${!this.pageVisibility_.setTheme}" label="$i18n{themes}"
          sub-label="${this.themeSublabel_}" @click="${this.onThemeClick_}"
          external>
      </cr-link-row>
<if expr="not is_linux">
      ${this.themeIdPref_?.value ? html`
        <div class="separator"></div>
        <cr-button id="useDefault" @click="${this.onUseDefaultClick_}"
            aria-label="$i18n{resetToDefaultTheme}">
          $i18n{resetToDefault}
        </cr-button>
      ` : ''}
</if>
<if expr="is_linux">
      <div class="settings-row continuation"
          ?hidden="${!this.showThemesSecondary_()}" id="themesSecondaryActions">
        <div class="separator"></div>
        ${this.showUseClassic_() ? html`
          <cr-button id="useDefault" @click="${this.onUseDefaultClick_}">
            $i18n{useClassicTheme}
          </cr-button>
        ` : ''}
        ${this.showUseGtk_() ? html`
          <cr-button id="useGtk" @click="${this.onUseGtkClick_}">
            $i18n{useGtkTheme}
          </cr-button>
        ` : ''}
        ${this.showUseQt_() ? html`
          <cr-button id="useQt" @click="${this.onUseQtClick_}">
            $i18n{useQtTheme}
          </cr-button>
        ` : ''}
      </div>
</if>
    </div>
<if expr="is_linux">
    <cr-link-row id="linuxAnimationSpeed" class="hr"
        label="Скорость анимаций интерфейса"
        sub-label="Дополнительная настройка. Применяется после перезапуска."
        @click="${this.onLinuxAnimationSpeedClick_}" external>
    </cr-link-row>
</if>
    <settings-toggle-button class="hr" pref-key="search.suggest_enabled"
        label="Подсказки поисковой системы"
        sub-label="Показывать сетевые подсказки при вводе. Локальная история остаётся доступной и после выключения.">
    </settings-toggle-button>
    <div id="toolbarRow" class="settings-row">
      <cr-link-row id="customizeToolbar" label="$i18n{customizeToolbar}"
          @click="${this.onCustomizeToolbarClick_}" external>
      </cr-link-row>
      ${this.showResetPinnedActionsButton_ ? html`
        <div class="separator"></div>
        <cr-button id="resetPinnedToolbarActions"
            @click="${this.onResetPinnedToolbarActionsClick_}"
            aria-label="$i18n{resetToolbarToDefault}">
          $i18n{resetToDefault}
        </cr-button>
      ` : ''}
    </div>
    <div id="colorSchemeModeRow" class="cr-row"
        ?hidden="${!this.showColorSchemeMode_()}">
      <div id="colorSchemeModeLabel" class="flex cr-padded-text"
          aria-hidden="true">
        $i18n{colorSchemeMode}
      </div>
      <select id="colorSchemeModeSelect" class="md-select"
          @change="${this.onColorSchemeModeChange_}"
          aria-labelledby="colorSchemeModeLabel">
        ${this.colorSchemeModeOptions_.map(item => html`
          <option value="${item.value}"
              ?selected="${this.isSelectedColorSchemeMode_(item.value)}">
            ${item.name}
          </option>
        `)}
      </select>
    </div>
    <div class="hr"
        ?hidden="${!this.showHr_(
            this.pageVisibility_.setTheme, this.pageVisibility_.homeButton)}">
    </div>
    <settings-toggle-button elide-label
        ?hidden="${!this.pageVisibility_.homeButton}"
        pref-key="browser.show_home_button" label="$i18n{showHomeButton}"
        sub-label="${this.getShowHomeSubLabel_()}">
    </settings-toggle-button>
    ${this.showHomeButtonPref_?.value ? html`
      <div id="home-button-options" class="list-frame"
          ?hidden="${!this.pageVisibility_.homeButton}">
        <settings-radio-group pref-key="homepage_is_newtabpage">
          <controlled-radio-button class="list-item" name="true"
              pref-key="homepage_is_newtabpage" label="$i18n{homePageNtp}"
              no-extension-indicator>
          </controlled-radio-button>
          <controlled-radio-button id="custom-input" class="list-item"
              name="false" pref-key="homepage_is_newtabpage"
              no-extension-indicator>
            <!-- TODO(dbeam): this can show double indicators when both
                 homepage and whether to use the NTP as the homepage are
                 managed. -->
            <home-url-input id="customHomePage"
                .canTab="${!this.homepageIsNewTabPagePref_?.value}">
            </home-url-input>
          </controlled-radio-button>
          ${this.homepagePref_?.extensionId ? html`
            <extension-controlled-indicator
                extension-id="${this.homepagePref_.extensionId}"
                ?extension-can-be-disabled="${
                    !!this.homepagePref_?.extensionCanBeDisabled}"
                extension-name="${this.homepagePref_.controlledByName}"
                @disable-extension-click="${this.onDisableExtensionClick_}">
            </extension-controlled-indicator>
          ` : ''}
        </settings-radio-group>
      </div>
    ` : ''}
    <div class="hr"
        ?hidden="${!this.showHr_(
            this.pageVisibility_.homeButton,
            this.pageVisibility_.bookmarksBar)}">
    </div>
    ${!this.ntpSimplificationBookmarksBarEnabled_ ? html`
      <settings-toggle-button id="showBookmarksBar"
          ?hidden="${!this.pageVisibility_.bookmarksBar}"
          pref-key="bookmark_bar.show_on_all_tabs"
          label="$i18n{showBookmarksBar}">
      </settings-toggle-button>
    ` : ''}
    ${this.ntpSimplificationBookmarksBarEnabled_ ? html`
      <div class="cr-row" ?hidden="${!this.pageVisibility_.bookmarksBar}">
        <div class="flex cr-padded-text" aria-hidden="true">
          $i18n{bookmarksBar}
        </div>
        <settings-dropdown-menu id="bookmarksBarVisibilityDropdown"
            label="$i18n{bookmarksBar}" pref-key="bookmark_bar.visibility_state"
            .menuOptions="${this.bookmarksBarOptions_}"
            @settings-control-change="${
                this.onBookmarksBarVisibilitySettingsControlChange_}">
        </settings-dropdown-menu>
      </div>
    ` : ''}

<if expr="is_macosx">
    ${this.showGlassEffectEnabled_ ? html`
      <div class="cr-row hr">
        <div class="flex cr-padded-text" aria-hidden="true">
          $i18n{glassEffect}
        </div>
        <settings-dropdown-menu id="glassEffect" label="$i18n{glassEffect}"
            pref-key="glass_frame.enabled"
            .menuOptions="${this.glassEffectOptions_}"
            @settings-control-change="${
                this.onGlassFrameSettingsControlChange_}">
        </settings-dropdown-menu>
      </div>
    ` : ''}
</if>


    <div class="cr-row">
      <div class="flex cr-padded-text" aria-hidden="true">
        $i18n{tabStripPosition}
      </div>
      <settings-dropdown-menu id="tabStripPosition"
          label="$i18n{tabStripPosition}" pref-key="vertical_tabs.enabled"
          .menuOptions="${this.tabStripOptions_}" @settings-control-change="${
              this.onTabStripPositionSettingsControlChange_}">
      </settings-dropdown-menu>
    </div>
    <div class="list-frame indented-toggles"
        ?hidden="${!this.verticalTabsEnabledPref_?.value}">
      ${this.showVerticalTabsExpandOnHoverSetting_() ? html`
        <settings-toggle-button id="showVerticalTabsExpandOnHover"
            pref-key="vertical_tabs.expand_on_hover"
            label="$i18n{showVerticalTabsExpandOnHover}">
        </settings-toggle-button>
      ` : ''}

      ${this.showEverythingMenuToggle_() ? html`
        <settings-toggle-button id="showEverythingMenuButton"
            pref-key="everything_menu.pinned_to_tabstrip"
            label="$i18n{showEverythingMenuButton}"
            @change="${this.onShowEverythingMenuButtonChange_}">
        </settings-toggle-button>
      ` : ''}
    </div>
    ${this.tabStripUnificationEnabled_ ? html`
      <div class="list-frame indented-toggles"
          ?hidden="${!!this.verticalTabsEnabledPref_?.value}">
        <settings-toggle-button id="tabScrollAutoShowOnOverflow"
            pref-key="tab_scroll_buttons.pinned_to_tabstrip"
            label="$i18n{tabScrollAutoShowOnOverflow}"
            @change="${this.onTabScrollAutoShowOnOverflowChange_}">
        </settings-toggle-button>
      </div>
    ` : ''}

    ${this.showOrganizerPanelEnabled_ ? html`
      <settings-toggle-button id="showOrganizerPanelButton"
          pref-key="tab_search.pinned_to_tabstrip"
          label="$i18n{showTabSearchButton}"
          @change="${this.onShowOrganizerPanelButtonChange_}">
      </settings-toggle-button>
    ` : html`
      <settings-toggle-button id="showTabSearchButton" class="hr"
          pref-key="tab_search.pinned_to_tabstrip"
          label="$i18n{showTabSearchButton}"
          @change="${this.onShowTabSearchButtonChange_}">
      </settings-toggle-button>
    `}


    <settings-toggle-button class="hr" id="showSavedTabGroups"
        pref-key="bookmark_bar.show_tab_groups"
        label="$i18n{showTabGroupsInBookmarksBar}"
        ?hidden="${this.showOrganizerPanelEnabled_}">
    </settings-toggle-button>

    <settings-toggle-button class="hr" id="autoPinNewTabGroups"
        pref-key="auto_pin_new_tab_groups" label="$i18n{autoPinNewTabGroups}"
        ?hidden="${this.showOrganizerPanelEnabled_}">
    </settings-toggle-button>

    ${this.showCtrlTabMru_ ? html`
      <settings-toggle-button class="hr" id="ctrlTabMru"
          pref-key="browser.ctrl_tab_mru" label="$i18n{ctrlTabMru}">
      </settings-toggle-button>
    ` : ''}

    <div class="cr-row">$i18n{sidePanelPosition}</div>
    <div class="list-frame indented-rows">
      ${this.configurableSidePanels_.map(item => html`
        <div class="cr-row continuation">
          <div class="flex cr-padded-text" aria-hidden="true">
            ${item.label}
          </div>
          <settings-dropdown-menu
              label="${this.i18n(
                  'sidePanelAlignmentA11yLabel', item.label,
                  '$i18n{sidePanelPosition}')}"
              .menuOptions="${this.sidePanelAlignmentOptions_}"
              data-entry-id="${item.id}" pref-key="side_panel.is_right_aligned"
              no-set-pref value="${this.getOverrideValue_(item.id)}"
              @settings-control-change="${
                  this.onOverrideAlignmentSettingsControlChange_}">
          </settings-dropdown-menu>
        </div>
      `)}

      <div class="cr-row continuation">
        <div class="flex cr-padded-text" aria-hidden="true">
          $i18n{sidePanelAlignmentChromePanels}
        </div>
        <settings-dropdown-menu id="sidePanelPosition"
            label="${this.i18n(
                'sidePanelAlignmentA11yLabel',
                '$i18n{sidePanelAlignmentChromePanels}',
                '$i18n{sidePanelPosition}')}"
            pref-key="side_panel.is_right_aligned"
            .menuOptions="${this.sidePanelAlignmentOptions_}">
        </settings-dropdown-menu>
      </div>
    </div>
    ${!this.showHoverCardImagesOption_ ? html`
      <div class="hr" ?hidden="${!this.pageVisibility_.hoverCard}"></div>
      <settings-toggle-button id="hoverCardMemoryUsageToggle"
          ?hidden="${!this.pageVisibility_.hoverCard}"
          pref-key="browser.hovercard.memory_usage_enabled"
          label="$i18n{showHoverCardMemoryUsageStandalone}">
      </settings-toggle-button>
    ` : ''}
    ${this.showHoverCardImagesOption_ ? html`
      <div class="cr-row" ?hidden="${!this.pageVisibility_.hoverCard}">
        $i18n{hoverCardTitle}
      </div>
      <div class="list-frame indented-toggles">
        <settings-toggle-button id="hoverCardImagesToggle"
            ?hidden="${!this.pageVisibility_.hoverCard}"
            @settings-boolean-control-change="${
                this.onHoverCardImagesSettingsBooleanControlChange_}"
            pref-key="browser.hovercard.image_previews_enabled"
            label="$i18n{showHoverCardImages}">
        </settings-toggle-button>
        <settings-toggle-button id="hoverCardMemoryUsageToggle" class="hr"
            ?hidden="${!this.pageVisibility_.hoverCard}"
            @settings-boolean-control-change="${
                this.onHoverCardMemoryUsageSettingsBooleanControlChange_}"
            pref-key="browser.hovercard.memory_usage_enabled"
            label="$i18n{showHoverCardMemoryUsage}">
        </settings-toggle-button>
      </div>
    ` : ''}

<if expr="is_linux">
    <div class="hr" ?hidden="${!this.pageVisibility_.bookmarksBar}"></div>
    <settings-toggle-button ?hidden="${!this.showCustomChromeFrame_}"
        pref-key="browser.custom_chrome_frame"
        label="$i18n{showWindowDecorations}" inverted>
    </settings-toggle-button>
</if>
    <div class="cr-row">
      <div class="flex cr-padded-text" aria-hidden="true">
        $i18n{fontSize}
      </div>
      <settings-dropdown-menu id="defaultFontSize" label="$i18n{fontSize}"
          pref-key="webkit.webprefs.default_font_size"
          .menuOptions="${this.fontSizeOptions_}">
      </settings-dropdown-menu>
    </div>
    <cr-link-row class="hr" id="customize-fonts-subpage-trigger"
        label="$i18n{customizeFonts}" @click="${this.onCustomizeFontsClick_}"
        role-description="$i18n{subpageArrowRoleDescription}">
    </cr-link-row>
    <div class="cr-row" ?hidden="${!this.pageVisibility_.pageZoom}">
      <div id="pageZoom" class="flex cr-padded-text" aria-hidden="true">
        $i18n{pageZoom}
      </div>
      <select id="zoomLevel" class="md-select" aria-labelledby="pageZoom"
          @change="${this.onZoomLevelChange_}">
        ${this.pageZoomLevels_.map(item => html`
          <option value="${item}"
              ?selected="${this.zoomValuesEqual_(item, this.defaultZoom_)}">
            ${this.formatZoom_(item)}%
          </option>
        `)}
      </select>
    </div>
<if expr="is_macosx">
    <settings-toggle-button class="hr" pref-key="webkit.webprefs.tabs_to_links"
        label="$i18n{tabsToLinks}">
    </settings-toggle-button>
    <settings-toggle-button class="hr" pref-key="browser.confirm_to_quit"
        label="$i18n{warnBeforeQuitting}">
    </settings-toggle-button>
</if>
  </div>
  <settings-toggle-button class="hr" id="splitViewDragAndDrop"
      pref-key="browser.split_view_drag_and_drop_enabled"
      label="${this.i18n(
          this.splitViewHorizontalEnabled_ ?
              'allowSplitViewDragAndDropHorizontal' :
              'allowSplitViewDragAndDrop')}">
  </settings-toggle-button>
  ${this.shouldShowRelaunchDialog ? html`
    <relaunch-confirmation-dialog .restartType="${RestartType.RESTART}"
        @close="${this.onRelaunchDialogClose}">
    </relaunch-confirmation-dialog>
  ` : ''}
</settings-section>
${this.showManagedThemeDialog_ ? html`
  <managed-dialog @close="${this.onManagedDialogClose_}"
      title="$i18n{themeManagedDialogTitle}"
      body="$i18n{themeManagedDialogBody}">
  </managed-dialog>
` : ''}
<!--_html_template_end_-->`;
}
