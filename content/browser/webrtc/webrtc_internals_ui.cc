// Copyright 2013 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "content/browser/webrtc/webrtc_internals_ui.h"

#include "content/browser/webrtc/resources/grit/webrtc_internals_resources.h"
#include "content/browser/webrtc/resources/grit/webrtc_internals_resources_map.h"
#include "content/browser/webrtc/webrtc_internals_message_handler.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "content/public/common/url_constants.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"

namespace content {
namespace {

void CreateAndAddWebRTCInternalsHTMLSource(BrowserContext* browser_context) {
  WebUIDataSource* source = WebUIDataSource::CreateAndAdd(
      browser_context, kChromeUIWebRTCInternalsHost);

  // Only this diagnostics page uses a bundled Wasm module for numeric stats.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::ScriptSrc,
      "script-src chrome://resources 'self' 'wasm-unsafe-eval';");
  source->UseStringsJs();
  source->AddResourcePaths(kWebrtcInternalsResources);
  source->SetDefaultResource(IDR_WEBRTC_INTERNALS_WEBRTC_INTERNALS_HTML);
}

}  // namespace

////////////////////////////////////////////////////////////////////////////////
//
// WebRTCInternalsUI
//
////////////////////////////////////////////////////////////////////////////////

WebRTCInternalsUI::WebRTCInternalsUI(WebUI* web_ui)
    : WebUIController(web_ui) {
  web_ui->AddMessageHandler(std::make_unique<WebRTCInternalsMessageHandler>());

  CreateAndAddWebRTCInternalsHTMLSource(
      web_ui->GetWebContents()->GetBrowserContext());
}

}  // namespace content
