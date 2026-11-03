// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_OPTIMIUM_APPEARANCE_PREFS_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_OPTIMIUM_APPEARANCE_PREFS_H_

#include <string>

#include "base/command_line.h"
#include "chrome/browser/profiles/profile.h"
#include "components/prefs/pref_service.h"

namespace optimium {

// A deliberate setting in Optimium takes precedence over legacy experiments.
// Checking registration also makes these helpers safe for lightweight profiles
// used by Views tests, which do not necessarily create a ThemeService.
inline bool HasAppearancePreference(const Profile* profile, const char* key) {
  const auto* prefs = profile ? profile->GetPrefs() : nullptr;
  const auto* pref = prefs ? prefs->FindPreference(key) : nullptr;
  return pref && pref->HasUserSetting();
}

inline int GetPanelOpacityPercent(const Profile* profile) {
  if (!profile || profile->IsOffTheRecord()) {
    return 100;
  }
  constexpr char kPref[] = "optimium.appearance.panel_opacity";
  if (HasAppearancePreference(profile, kPref)) {
    const int value = profile->GetPrefs()->GetInteger(kPref);
    return value == 50 || value == 70 || value == 85 ? value : 100;
  }
  const auto value = base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
      "linux-ui-transparency");
  if (value == "50") {
    return 50;
  }
  if (value == "70") {
    return 70;
  }
  return value == "85" ? 85 : 100;
}

inline std::string GetTabStyle(const Profile* profile) {
  constexpr char kPref[] = "optimium.appearance.tab_style";
  if (HasAppearancePreference(profile, kPref)) {
    return profile->GetPrefs()->GetString(kPref);
  }
  return "rounded";
}

inline std::string GetTabTint(const Profile* profile) {
  constexpr char kPref[] = "optimium.appearance.tab_tint";
  if (HasAppearancePreference(profile, kPref)) {
    return profile->GetPrefs()->GetString(kPref);
  }
  return base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
      "linux-tab-background-tint");
}

inline bool AnimateTabTint(const Profile* profile) {
  constexpr char kPref[] = "optimium.appearance.tab_animation";
  if (HasAppearancePreference(profile, kPref)) {
    return profile->GetPrefs()->GetBoolean(kPref);
  }
  return base::CommandLine::ForCurrentProcess()->HasSwitch(
      "linux-tab-background-animation");
}

}  // namespace optimium

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_OPTIMIUM_APPEARANCE_PREFS_H_
