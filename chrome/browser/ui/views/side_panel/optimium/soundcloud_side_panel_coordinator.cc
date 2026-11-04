// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/side_panel/optimium/soundcloud_side_panel_coordinator.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/strings/strcat.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/app/vector_icons/vector_icons.h"
#include "chrome/browser/content_settings/page_specific_content_settings_delegate.h"
#include "chrome/browser/file_select_helper.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/task_manager/web_contents_tags.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/prefs/prefs_tab_helper.h"
#include "chrome/browser/ui/side_panel/side_panel_entry.h"
#include "chrome/browser/ui/side_panel/side_panel_registry.h"
#include "chrome/browser/ui/side_panel/side_panel_ui.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/webui/webui_embedding_context.h"
#include "components/content_settings/browser/page_specific_content_settings.h"
#include "components/javascript_dialogs/app_modal_dialog_manager.h"
#include "components/permissions/permission_recovery_success_rate_tracker.h"
#include "components/permissions/permission_request_manager.h"
#include "components/version_info/version_info.h"
#include "components/web_modal/web_contents_modal_dialog_manager.h"
#include "components/web_modal/web_contents_modal_dialog_manager_delegate.h"
#include "content/public/browser/file_select_listener.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/page_navigator.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "third_party/blink/public/common/user_agent/user_agent_metadata.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/mojom/window_open_disposition.mojom.h"
#include "ui/views/background.h"
#include "ui/views/controls/button/image_button.h"
#include "ui/views/controls/button/image_button_factory.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/webview/web_contents_delegate_views.h"
#include "ui/views/controls/webview/webview.h"
#include "ui/views/layout/box_layout.h"
#include "ui/views/view.h"
#include "ui/views/widget/widget.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace {

constexpr char kLibraryUrl[] = "https://m.soundcloud.com/you/library";

// This is a native WebContents rather than an iframe or a WebUI wrapper. The
// site's frame-ancestors / X-Frame-Options policy therefore remains untouched.
class SoundCloudPanelView
    : public views::View,
      public views::WebContentsDelegateViews<SoundCloudPanelView>,
      public content::WebContentsObserver,
      public web_modal::WebContentsModalDialogManagerDelegate {
  METADATA_HEADER(SoundCloudPanelView, views::View)

 public:
  SoundCloudPanelView(BrowserWindowInterface* browser,
                      content::WebContents* contents,
                      bool first_open)
      : browser_(browser) {
    SetBackground(views::CreateSolidBackground(kColorToolbar));
    auto* layout = SetLayoutManager(std::make_unique<views::BoxLayout>(
        views::BoxLayout::Orientation::kVertical));
    auto* toolbar = AddChildView(std::make_unique<views::View>());
    toolbar->SetLayoutManager(std::make_unique<views::BoxLayout>(
        views::BoxLayout::Orientation::kHorizontal, gfx::Insets(6), 6));
    toolbar->AddChildView(std::make_unique<views::MdTextButton>(
        base::BindRepeating(&SoundCloudPanelView::GoBack,
                            base::Unretained(this)),
        u"Назад"));
    toolbar->AddChildView(std::make_unique<views::MdTextButton>(
        base::BindRepeating(&SoundCloudPanelView::Reload,
                            base::Unretained(this)),
        u"Обновить"));
    toolbar->AddChildView(std::make_unique<views::MdTextButton>(
        base::BindRepeating(&SoundCloudPanelView::LoadLibrary,
                            base::Unretained(this)),
        u"Медиатека"));
    auto open_in_tab = views::CreateVectorImageButtonWithNativeTheme(
        base::BindRepeating(&SoundCloudPanelView::OpenInTab,
                            base::Unretained(this)),
        kOpenInNewIcon);
    open_in_tab->SetTooltipText(u"Открыть SoundCloud в обычной вкладке");
    open_in_tab->SetPreferredSize(gfx::Size(36, 36));
    toolbar->AddChildView(std::move(open_in_tab));
    origin_label_ = AddChildView(std::make_unique<views::Label>(
        u"m.soundcloud.com"));
    origin_label_->SetHorizontalAlignment(gfx::ALIGN_LEFT);
    origin_label_->SetMultiLine(true);
    origin_label_->SetAllowCharacterBreak(true);

    web_view_ =
        AddChildView(std::make_unique<views::WebView>(browser->GetProfile()));
    layout->SetFlexForView(web_view_, 1);
    SetAcceleratorHandling(views::WebContentsAcceleratorHandling::kEnabled);
    web_view_->SetWebContents(contents);
    contents->SetDelegate(this);
    Observe(contents);
    if (!first_open) {
      const GURL& url = contents->GetLastCommittedURL();
      if (url.is_valid()) {
        origin_label_->SetText(
            base::UTF8ToUTF16(url::Origin::Create(url).Serialize()));
        origin_label_->SetTooltipText(base::UTF8ToUTF16(url.spec()));
      }
      web_modal::WebContentsModalDialogManager::FromWebContents(contents)
          ->SetDelegate(this);
      return;
    }
    webui::SetBrowserWindowInterface(contents, browser);
    PrefsTabHelper::CreateForWebContents(contents);
    permissions::PermissionRequestManager::CreateForWebContents(contents);
    permissions::PermissionRecoverySuccessRateTracker::CreateForWebContents(
        contents);
    content_settings::PageSpecificContentSettings::CreateForWebContents(
        contents,
        std::make_unique<PageSpecificContentSettingsDelegate>(contents));
    web_modal::WebContentsModalDialogManager::CreateForWebContents(contents);
    web_modal::WebContentsModalDialogManager::FromWebContents(contents)
        ->SetDelegate(this);
    task_manager::WebContentsTags::CreateForTabContents(contents);

    // Desktop SoundCloud has a fixed-width layout. The site's own mobile
    // layout works at side-panel widths without injecting CSS or modifying its
    // login code. The override is confined to this WebContents and is not
    // inherited by popup windows or normal browser tabs.
    const std::string ua = base::StrCat(
        {"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like "
         "Gecko) Chrome/",
         version_info::GetVersionNumber(), " Mobile Safari/537.36"});
    contents->SetUserAgentOverride(blink::UserAgentOverride::UserAgentOnly(ua),
                                   /*override_in_new_tabs=*/false);
    LoadLibrary();
  }

  ~SoundCloudPanelView() override {
    auto* contents = web_view_->GetWebContents();
    Observe(nullptr);
    web_modal::WebContentsModalDialogManager::FromWebContents(contents)
        ->SetDelegate(nullptr);
    contents->SetDelegate(nullptr);
  }

  content::WebContents* OpenURLFromTab(
      content::WebContents* source,
      const content::OpenURLParams& params,
      base::OnceCallback<void(content::NavigationHandle&)>
          navigation_handle_callback) override {
    // Don't provide the remote site a route into privileged browser pages or
    // local files. The normal network, cookie and origin policies still apply.
    if (!params.url.SchemeIsHTTPOrHTTPS()) {
      return nullptr;
    }
    if (params.disposition == ui::mojom::WindowOpenDisposition::kCurrentTab) {
      auto navigation = source->GetController().LoadURLWithParams(
          content::NavigationController::LoadURLParams(params));
      if (navigation && navigation_handle_callback) {
        std::move(navigation_handle_callback).Run(*navigation);
      }
      return source;
    }
    if (!params.user_gesture) {
      return nullptr;
    }
    return browser_->OpenURL(params, std::move(navigation_handle_callback));
  }

  content::WebContents* AddNewContents(
      content::WebContents* source,
      std::unique_ptr<content::WebContents> new_contents,
      const GURL& target_url,
      ui::mojom::WindowOpenDisposition disposition,
      const blink::mojom::WindowFeatures& window_features,
      bool user_gesture,
      bool* was_blocked) override {
    // The panel is not in a TabStripModel, so it has no tab popup-blocker
    // helper. Require a real gesture instead of silently permitting popups.
    // about:blank is needed by OAuth flows that navigate their popup later.
    if (!user_gesture ||
        (!target_url.SchemeIsHTTPOrHTTPS() && !target_url.IsAboutBlank())) {
      if (was_blocked) {
        *was_blocked = true;
      }
      return nullptr;
    }
    if (was_blocked) {
      *was_blocked = false;
    }
    new_contents->SetUserAgentOverride(blink::UserAgentOverride(), false);
    // Transfer the actual popup, rather than reopening its URL: this preserves
    // window.opener, sessionStorage and the site's OAuth postMessage channel.
    return chrome::AddWebContents(browser_, source, std::move(new_contents),
                                  target_url, disposition, window_features,
                                  NavigateParams::WindowAction::kShowWindow,
                                  user_gesture);
  }

  void RunFileChooser(content::RenderFrameHost* frame,
                      scoped_refptr<content::FileSelectListener> listener,
                      const blink::mojom::FileChooserParams& params) override {
    FileSelectHelper::RunFileChooser(frame, std::move(listener), params);
  }

  void RequestMediaAccessPermission(
      content::WebContents* contents,
      const content::MediaStreamRequest& request,
      content::MediaResponseCallback callback) override {
    MediaCaptureDevicesDispatcher::GetInstance()->ProcessMediaAccessRequest(
        contents, request, std::move(callback), nullptr);
  }

  bool CheckMediaAccessPermission(content::RenderFrameHost* frame,
                                  const url::Origin& origin,
                                  blink::mojom::MediaStreamType type) override {
    return MediaCaptureDevicesDispatcher::GetInstance()
        ->CheckMediaAccessPermission(frame, origin, type, nullptr);
  }

  content::JavaScriptDialogManager* GetJavaScriptDialogManager(
      content::WebContents* source) override {
    return javascript_dialogs::AppModalDialogManager::GetInstance();
  }

  web_modal::WebContentsModalDialogHost* GetWebContentsModalDialogHost(
      content::WebContents* contents) override {
    auto* browser_view = BrowserView::GetBrowserViewForBrowser(browser_);
    return browser_view ? browser_view->GetWebContentsModalDialogHost()
                        : nullptr;
  }

  bool IsWebContentsVisible(content::WebContents* contents) override {
    return web_view_->IsDrawn();
  }

  void DidFinishNavigation(content::NavigationHandle* navigation) override {
    if (!navigation->IsInPrimaryMainFrame() || !navigation->HasCommitted()) {
      return;
    }
    const GURL& url = navigation->GetURL();
    origin_label_->SetText(
        base::UTF8ToUTF16(url::Origin::Create(url).Serialize()));
    origin_label_->SetTooltipText(base::UTF8ToUTF16(url.spec()));
  }

 private:
  void GoBack() {
    auto& controller = web_view_->GetWebContents()->GetController();
    if (controller.CanGoBack()) {
      controller.GoBack();
    }
  }

  void Reload() {
    web_view_->GetWebContents()->GetController().Reload(
        content::ReloadType::NORMAL, true);
  }

  void LoadLibrary() {
    content::NavigationController::LoadURLParams params{GURL(kLibraryUrl)};
    params.override_user_agent =
        content::NavigationController::UA_OVERRIDE_TRUE;
    web_view_->GetWebContents()->GetController().LoadURLWithParams(params);
  }

  void OpenInTab() {
    GURL url = web_view_->GetWebContents()->GetLastCommittedURL();
    if (!url.SchemeIsHTTPOrHTTPS()) {
      url = GURL(kLibraryUrl);
    }
    browser_->OpenGURL(url,
                       ui::mojom::WindowOpenDisposition::kNewForegroundTab);
  }

  const raw_ptr<BrowserWindowInterface> browser_;
  raw_ptr<views::WebView> web_view_ = nullptr;
  raw_ptr<views::Label> origin_label_ = nullptr;
};

BEGIN_METADATA(SoundCloudPanelView)
END_METADATA

}  // namespace

DEFINE_USER_DATA(OptimiumSoundCloudSidePanelCoordinator);

OptimiumSoundCloudSidePanelCoordinator::OptimiumSoundCloudSidePanelCoordinator(
    BrowserWindowInterface* browser)
    : browser_(browser),
      scoped_unowned_user_data_(browser->GetUnownedUserDataHost(), *this) {
  auto entry = std::make_unique<SidePanelEntry>(
      SidePanelEntry::Key(SidePanelEntryId::kOptimiumSoundCloud),
      base::BindRepeating(&OptimiumSoundCloudSidePanelCoordinator::CreateView,
                          base::Unretained(this)),
      base::BindRepeating([] { return 440; }));
  entry->AddObserver(this);
  SidePanelRegistry::From(browser)->Register(std::move(entry));
}

OptimiumSoundCloudSidePanelCoordinator::
    ~OptimiumSoundCloudSidePanelCoordinator() {
  auto* registry = SidePanelRegistry::From(browser_);
  const SidePanelEntry::Key key(SidePanelEntryId::kOptimiumSoundCloud);
  if (auto* entry = registry->GetEntryForKey(key)) {
    entry->RemoveObserver(this);
    registry->Deregister(key);
  }
  if (contents_) {
    webui::SetBrowserWindowInterface(contents_.get(), nullptr);
  }
}

// static
OptimiumSoundCloudSidePanelCoordinator*
OptimiumSoundCloudSidePanelCoordinator::From(BrowserWindowInterface* browser) {
  return Get(browser->GetUnownedUserDataHost());
}

bool OptimiumSoundCloudSidePanelCoordinator::Show() {
  auto* ui = SidePanelUI::From(browser_);
  if (!ui) {
    return false;
  }
  ui->Show(SidePanelEntryId::kOptimiumSoundCloud,
           SidePanelOpenTrigger::kNewTabPage);
  return true;
}

content::WebContents*
OptimiumSoundCloudSidePanelCoordinator::GetWebContents() const {
  return contents_.get();
}

std::unique_ptr<views::View> OptimiumSoundCloudSidePanelCoordinator::CreateView(
    SidePanelEntryScope& scope) {
  const bool first_open = !contents_;
  if (first_open) {
    content::WebContents::CreateParams params(browser_->GetProfile());
    contents_ = content::WebContents::Create(params);
  }
  return std::make_unique<SoundCloudPanelView>(browser_, contents_.get(),
                                               first_open);
}

void OptimiumSoundCloudSidePanelCoordinator::OnEntryHidden(
    SidePanelEntry* entry) {
  // Discard the transient view; the window-owned WebContents survives so its
  // page and media session can continue while the panel is hidden. No site
  // process or network request is created until the panel is first opened.
  entry->ClearCachedView();
}
