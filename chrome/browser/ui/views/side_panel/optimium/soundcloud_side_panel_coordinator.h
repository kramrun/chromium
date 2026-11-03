// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_SIDE_PANEL_OPTIMIUM_SOUNDCLOUD_SIDE_PANEL_COORDINATOR_H_
#define CHROME_BROWSER_UI_VIEWS_SIDE_PANEL_OPTIMIUM_SOUNDCLOUD_SIDE_PANEL_COORDINATOR_H_

#include <memory>

#include "base/memory/raw_ptr.h"
#include "chrome/browser/ui/side_panel/side_panel_entry_observer.h"
#include "ui/base/unowned_user_data/scoped_unowned_user_data.h"

class BrowserWindowInterface;
class SidePanelEntry;
class SidePanelEntryScope;
namespace views {
class View;
}

// A window-scoped, lazily loaded ordinary web page. It shares the window's
// profile, but has no privileged WebUI bindings or guest storage partition.
class OptimiumSoundCloudSidePanelCoordinator : public SidePanelEntryObserver {
 public:
  explicit OptimiumSoundCloudSidePanelCoordinator(
      BrowserWindowInterface* browser);
  ~OptimiumSoundCloudSidePanelCoordinator() override;

  DECLARE_USER_DATA(OptimiumSoundCloudSidePanelCoordinator);
  static OptimiumSoundCloudSidePanelCoordinator* From(
      BrowserWindowInterface* browser);
  bool Show();

 private:
  std::unique_ptr<views::View> CreateView(SidePanelEntryScope& scope);
  void OnEntryHidden(SidePanelEntry* entry) override;

  const raw_ptr<BrowserWindowInterface> browser_;
  ui::ScopedUnownedUserData<OptimiumSoundCloudSidePanelCoordinator>
      scoped_unowned_user_data_;
};

#endif  // CHROME_BROWSER_UI_VIEWS_SIDE_PANEL_OPTIMIUM_SOUNDCLOUD_SIDE_PANEL_COORDINATOR_H_
