// Copyright 2015 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/webui/settings/appearance_handler.h"

#include "base/check.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"
#include "build/build_config.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/themes/theme_service_factory.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/side_panel/side_panel_action_callback.h"
#include "chrome/browser/ui/side_panel/side_panel_enums.h"
#include "chrome/browser/ui/tabs/vertical_tab_strip_metrics.h"
#include "chrome/browser/ui/toolbar/pinned_toolbar/pinned_toolbar_actions_model.h"
#include "chrome/browser/ui/webui/settings/settings_element_ids.h"
#include "chrome/browser/ui/webui/settings/settings_utils.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/web_ui.h"
#include "ui/actions/actions.h"

namespace settings {

AppearanceHandler::AppearanceHandler(content::WebUI* webui)
    : profile_(Profile::FromWebUI(webui)) {}

AppearanceHandler::~AppearanceHandler() = default;

void AppearanceHandler::OnJavascriptAllowed() {}
void AppearanceHandler::OnJavascriptDisallowed() {}

void AppearanceHandler::RegisterMessages() {
  web_ui()->RegisterMessageCallback(
      "getOptimiumTheme",
      base::BindRepeating(&AppearanceHandler::HandleGetOptimiumTheme,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "applyOptimiumTheme",
      base::BindRepeating(&AppearanceHandler::HandleApplyOptimiumTheme,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "getOptimiumAppearanceOptions",
      base::BindRepeating(&AppearanceHandler::HandleGetOptimiumAppearanceOptions,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "setOptimiumAppearanceOption",
      base::BindRepeating(&AppearanceHandler::HandleSetOptimiumAppearanceOption,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "useDefaultTheme",
      base::BindRepeating(&AppearanceHandler::HandleUseTheme,
                          base::Unretained(this), ui::SystemTheme::kDefault));
#if BUILDFLAG(IS_LINUX)
  web_ui()->RegisterMessageCallback(
      "useGtkTheme",
      base::BindRepeating(&AppearanceHandler::HandleUseTheme,
                          base::Unretained(this), ui::SystemTheme::kGtk));
  web_ui()->RegisterMessageCallback(
      "useQtTheme",
      base::BindRepeating(&AppearanceHandler::HandleUseTheme,
                          base::Unretained(this), ui::SystemTheme::kQt));
#endif

  web_ui()->RegisterMessageCallback(
      "openCustomizeChrome",
      base::BindRepeating(&AppearanceHandler::OpenCustomizeChrome,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "openCustomizeChromeToolbarSection",
      base::BindRepeating(&AppearanceHandler::OpenCustomizeChromeToolbarSection,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "resetPinnedToolbarActions",
      base::BindRepeating(&AppearanceHandler::ResetPinnedToolbarActions,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "pinnedToolbarActionsAreDefault",
      base::BindRepeating(&AppearanceHandler::PinnedToolbarActionsAreDefault,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "recordVerticalTabStripModeChanged",
      base::BindRepeating(
          &AppearanceHandler::HandleRecordVerticalTabStripModeChanged,
          base::Unretained(this)));
}

void AppearanceHandler::HandleUseTheme(ui::SystemTheme system_theme,
                                       const base::ListValue& args) {
  CHECK(system_theme != ui::SystemTheme::kDefault || !profile_->IsChild(),
        base::NotFatalUntil::M162);
  ThemeServiceFactory::GetForProfile(profile_)->UseTheme(system_theme);
  settings_utils::MaybeNotifySettingsCustomEvent(
      web_ui(), settings::kAppearanceThemeChangedId);
}

void AppearanceHandler::OpenCustomizeChrome(const base::ListValue& args) {
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser();
  if (!browser) {
    return;
  }
  chrome::ExecuteCommand(browser, IDC_SHOW_CUSTOMIZE_CHROME_SIDE_PANEL);
}

void AppearanceHandler::OpenCustomizeChromeToolbarSection(
    const base::ListValue& args) {
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser();
  CHECK(browser);
  chrome::ExecuteCommand(browser, IDC_SHOW_CUSTOMIZE_CHROME_TOOLBAR);
}

void AppearanceHandler::ResetPinnedToolbarActions(const base::ListValue& args) {
  PinnedToolbarActionsModel::Get(profile_)->ResetToDefault();
}

void AppearanceHandler::PinnedToolbarActionsAreDefault(
    const base::ListValue& args) {
  CHECK_EQ(1U, args.size());
  const base::Value& callback_id = args[0];
  const bool are_default =
      PinnedToolbarActionsModel::Get(profile_)->IsDefault();

  AllowJavascript();
  ResolveJavascriptCallback(callback_id, base::Value(are_default));
}

void AppearanceHandler::HandleRecordVerticalTabStripModeChanged(
    const base::ListValue& args) {
  CHECK_EQ(1U, args.size());
  const bool is_vertical = args[0].GetBool();
  tabs::RecordVerticalTabStripModeChanged(
      is_vertical, tabs::VerticalTabStripEntryPoint::kSettings);
}

void AppearanceHandler::HandleGetOptimiumTheme(const base::ListValue& args) {
  CHECK_EQ(args.size(), 1u);
  AllowJavascript();
  ResolveJavascriptCallback(
      args[0], profile_->GetPrefs()->GetDict(ThemeService::kOptimiumThemePref));
}

void AppearanceHandler::HandleApplyOptimiumTheme(const base::ListValue& args) {
  CHECK_EQ(args.size(), 2u);
  AllowJavascript();
  const bool applied = args[1].is_dict() && !profile_->IsChild() &&
      ThemeServiceFactory::GetForProfile(profile_)->ApplyOptimiumTheme(
          args[1].GetDict());
  ResolveJavascriptCallback(args[0], base::Value(applied));
  if (applied) {
    settings_utils::MaybeNotifySettingsCustomEvent(
        web_ui(), settings::kAppearanceThemeChangedId);
  }
}

void AppearanceHandler::HandleGetOptimiumAppearanceOptions(
    const base::ListValue& args) {
  CHECK_EQ(args.size(), 1u);
  AllowJavascript();
  PrefService* prefs = profile_->GetPrefs();
  base::DictValue result;
  for (const char* key : {"panel_opacity", "tab_style", "tab_tint",
                          "tab_animation", "website_theme_enabled"}) {
    const std::string pref = std::string("optimium.appearance.") + key;
    result.Set(key, prefs->GetValue(pref).Clone());
  }
#if BUILDFLAG(IS_LINUX)
  // Show the effective value for people migrating from the experimental flags.
  const base::CommandLine* command_line =
      base::CommandLine::ForCurrentProcess();
  if (!prefs->GetUserPrefValue("optimium.appearance.panel_opacity")) {
    int opacity;
    if (base::StringToInt(command_line->GetSwitchValueASCII(
                              "linux-ui-transparency"), &opacity) &&
        (opacity == 50 || opacity == 70 || opacity == 85)) {
      result.Set("panel_opacity", opacity);
    }
  }
  if (!prefs->GetUserPrefValue("optimium.appearance.tab_tint")) {
    const std::string tint =
        command_line->GetSwitchValueASCII("linux-tab-background-tint");
    if (tint == "purple" || tint == "blue" || tint == "turquoise" ||
        tint == "pink") {
      result.Set("tab_tint", tint);
    }
  }
  if (!prefs->GetUserPrefValue("optimium.appearance.tab_animation") &&
      command_line->HasSwitch("linux-tab-background-animation")) {
    result.Set("tab_animation", true);
  }
#endif
  ResolveJavascriptCallback(args[0], result);
}

void AppearanceHandler::HandleSetOptimiumAppearanceOption(
    const base::ListValue& args) {
  CHECK_EQ(args.size(), 3u);
  AllowJavascript();
  const std::string* name = args[1].GetIfString();
  const base::Value& value = args[2];
  bool valid = false;
  if (name && !profile_->IsChild()) {
    if (*name == "panel_opacity" && value.is_int()) {
      const int opacity = value.GetInt();
      valid = opacity == 50 || opacity == 70 || opacity == 85 || opacity == 100;
    } else if (*name == "tab_style" && value.is_string()) {
      const std::string& style = value.GetString();
      valid = style == "rounded" || style == "flat" || style == "compact";
    } else if (*name == "tab_tint" && value.is_string()) {
      const std::string& tint = value.GetString();
      valid = tint == "none" || tint == "purple" || tint == "blue" ||
              tint == "turquoise" || tint == "pink";
    } else if (*name == "tab_animation" || *name == "website_theme_enabled") {
      valid = value.is_bool();
    }
  }
  if (valid) {
    const std::string pref = "optimium.appearance." + *name;
    if (profile_->GetPrefs()->IsManagedPreference(pref)) {
      valid = false;
    } else {
      profile_->GetPrefs()->Set(pref, value);
      // Native views already observe theme updates and recalculate their paint.
      ThemeServiceFactory::GetForProfile(profile_)->RefreshOptimiumAppearance();
    }
  }
  ResolveJavascriptCallback(args[0], base::Value(valid));
}

}  // namespace settings
