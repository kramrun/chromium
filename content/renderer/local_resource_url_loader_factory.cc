// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "content/renderer/local_resource_url_loader_factory.h"

#include <cstdint>
#include <memory>
#include <utility>

#include "base/check.h"
#include "base/containers/map_util.h"
#include "base/containers/span.h"
#include "base/memory/ref_counted_memory.h"
#include "base/memory/scoped_refptr.h"
#include "base/strings/strcat.h"
#include "base/strings/string_view_util.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/task_traits.h"
#include "base/task/thread_pool.h"
#include "base/types/expected.h"
#include "content/common/web_ui_loading_util.h"
#include "content/public/common/content_client.h"
#include "content/public/common/url_constants.h"
#include "content/public/common/url_utils.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "net/base/mime_util.h"
#include "net/http/http_response_headers.h"
#include "net/socket/socket.h"
#include "services/network/public/cpp/parsed_headers.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/mojom/url_loader.mojom.h"
#include "services/network/public/mojom/url_loader_factory.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "third_party/blink/public/mojom/loader/local_resource_loader_config.mojom.h"
#include "ui/base/template_expressions.h"
#include "ui/base/webui/jstemplate_builder.h"
#include "url/origin.h"

namespace content {

namespace {

// Returns a Web UI resource path from the given URL, which is the URL path
// (without the leading slash) with the canonicalized query appended (if any).
std::string GetWebUIResourcePath(const GURL& url) {
  std::string path = std::string(url.path().substr(1));
  std::string canonical_query = GetCanonicalQuery(url);
  if (!canonical_query.empty()) {
    base::StrAppend(&path, {"?", canonical_query});
  }
  return path;
}

// Returns the mime type of the given URL. If the mime type cannot be
// determined, returns "text/html".
std::string GetMimeType(const GURL& url) {
  std::string mime_type;
  if (net::GetMimeTypeFromFile(base::FilePath::FromASCII(url.ExtractFileName()),
                               &mime_type)) {
    return mime_type;
  }
  return "text/html";
}

// Sends a response with the given `content`, `headers_str`, and `mime_type` to
// `client`.
void SendResponse(mojo::PendingRemote<network::mojom::URLLoaderClient> client,
                  std::string_view content,
                  std::string_view headers_str,
                  std::string_view mime_type) {
  auto url_response_head = network::mojom::URLResponseHead::New();
  url_response_head->mime_type = std::string(mime_type);
  scoped_refptr<net::HttpResponseHeaders> headers =
      base::MakeRefCounted<net::HttpResponseHeaders>(std::string(headers_str));
  headers->SetHeader(net::HttpRequestHeaders::kContentType,
                     url_response_head->mime_type);
  url_response_head->headers = headers;
  auto now_time = base::Time::Now();
  auto now_ticks = base::TimeTicks::Now();
  url_response_head->request_time = now_time;
  url_response_head->request_start = now_ticks;
  url_response_head->load_timing.request_start_time = now_time;
  url_response_head->load_timing.request_start = now_ticks;

  scoped_refptr<base::RefCountedString> bytes =
      base::MakeRefCounted<base::RefCountedString>(std::string(content));

  webui::SendData(std::move(url_response_head), std::move(client), std::nullopt,
                  bytes);
}

// Returns the bytes of the resource with the given `value`.
// This function assumes that the resource value is a resource ID.
scoped_refptr<base::RefCountedMemory> GetResourceBytes(
    const blink::mojom::LocalResourceValuePtr& value) {
  // In-memory responses are handled before looking up bundled resources.
  CHECK(value->is_resource_id());
  int resource_id = value->get_resource_id();
  return GetContentClient()->GetDataResourceBytes(resource_id);
}

}  // namespace

LocalResourceURLLoaderFactory::LocalResourceURLLoaderFactory(
    blink::mojom::LocalResourceLoaderConfigPtr config,
    mojo::PendingRemote<network::mojom::URLLoaderFactory> fallback)
    : sources_(base::MakeRefCounted<base::RefCountedData<SourceMap>>(
          std::move(config->sources))),
      fallback_(std::move(fallback)) {}

LocalResourceURLLoaderFactory::~LocalResourceURLLoaderFactory() = default;

bool LocalResourceURLLoaderFactory::CanServe(
    const network::ResourceRequest& request) const {
  const url::Origin origin = url::Origin::Create(request.url);

  auto it = sources_->data.find(origin);
  if (it == sources_->data.end()) {
    return false;
  }

  // Get the resource ID corresponding to the URL path.
  const blink::mojom::LocalResourceSourcePtr& source = it->second;
  std::string path_key = GetWebUIResourcePath(request.url);
  auto resource_it = source->path_to_resource_map.find(path_key);
  // The path-to-ID map may not have an entry for the given path. This can
  // happen for resources that are generated on-the-fly in the browser process.
  // Example: chrome://my-webui/strings.m.js
  if (resource_it == source->path_to_resource_map.end()) {
    return false;
  }

  if (resource_it->second->is_response_body()) {
    return true;
  }
  int resource_id = resource_it->second->get_resource_id();

  // Return true if the in-process ResourceBundle has the resource for this ID.
  return GetContentClient()->HasDataResource(resource_id);
}

void LocalResourceURLLoaderFactory::CreateLoaderAndStart(
    mojo::PendingReceiver<network::mojom::URLLoader> loader,
    int32_t request_id,
    uint32_t options,
    const network::ResourceRequest& request,
    mojo::PendingRemote<network::mojom::URLLoaderClient> client,
    const net::MutableNetworkTrafficAnnotationTag& traffic_annotation) {
  CHECK(fallback_);
  if (!CanServe(request)) {
    fallback_->CreateLoaderAndStart(std::move(loader), request_id, options,
                                    request, std::move(client),
                                    traffic_annotation);
    return;
  }
  // Only the "chrome" scheme is supported.
  CHECK(request.url.GetScheme() == kChromeUIScheme);
  // Parallelize calls to GetResourceAndRespond across multiple threads.
  // Needs to be posted to a SequencedTaskRunner as Mojo requires a
  // SequencedTaskRunner::CurrentDefaultHandle in scope.
  base::ThreadPool::CreateSequencedTaskRunner(
      {base::TaskPriority::USER_BLOCKING, base::MayBlock(),
       base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN})
      ->PostTask(FROM_HERE, base::BindOnce(GetResourceAndRespond, sources_,
                                           request, std::move(client)));
}

void LocalResourceURLLoaderFactory::Clone(
    mojo::PendingReceiver<network::mojom::URLLoaderFactory> receiver) {
  receivers_.Add(this, std::move(receiver));
}

// static
void LocalResourceURLLoaderFactory::GetResourceAndRespond(
    const scoped_refptr<const base::RefCountedData<SourceMap>> sources,
    const network::ResourceRequest& request,
    mojo::PendingRemote<network::mojom::URLLoaderClient> client) {
  const url::Origin origin = url::Origin::Create(request.url);

  auto it = sources->data.find(origin);
  CHECK(it != sources->data.end());

  const blink::mojom::LocalResourceSourcePtr& source = it->second;
  const auto& resource =
      source->path_to_resource_map.at(GetWebUIResourcePath(request.url));
  if (resource->is_response_body()) {
    SendResponse(std::move(client), resource->get_response_body(),
                 source->headers, GetMimeType(request.url));
    return;
  }

  // Mime type.
  auto url_response_head = network::mojom::URLResponseHead::New();
  url_response_head->mime_type = GetMimeType(request.url);
  std::string mime_type = url_response_head->mime_type;

  // Other headers.
  scoped_refptr<net::HttpResponseHeaders> headers =
      base::MakeRefCounted<net::HttpResponseHeaders>(source->headers);
  headers->SetHeader(net::HttpRequestHeaders::kContentType, mime_type);
  url_response_head->headers = headers;
  url_response_head->parsed_headers = network::PopulateParsedHeaders(
      url_response_head->headers.get(), request.url);
  auto now_time = base::Time::Now();
  auto now_ticks = base::TimeTicks::Now();
  url_response_head->request_time = now_time;
  url_response_head->request_start = now_ticks;
  url_response_head->load_timing.request_start_time = now_time;
  url_response_head->load_timing.request_start = now_ticks;

  // Handle Range header if request.
  std::optional<net::HttpByteRange> maybe_range = std::nullopt;
  base::expected<net::HttpByteRange, webui::GetRequestedRangeError>
      range_or_error = webui::GetRequestedRange(request.headers);
  // Errors (aside from 'no Range header') should be surfaced to the client.
  if (!range_or_error.has_value() &&
      range_or_error.error() != webui::GetRequestedRangeError::kNoRanges) {
    webui::CallOnError(std::move(client),
                       net::ERR_REQUEST_RANGE_NOT_SATISFIABLE);
    return;
  }

  if (range_or_error.has_value()) {
    maybe_range = range_or_error.value();
  }

  webui::SendData(
      std::move(url_response_head), std::move(client), maybe_range,
      GetResource(request.url, source, mime_type));
}

// static
scoped_refptr<base::RefCountedMemory>
LocalResourceURLLoaderFactory::GetResource(
    const GURL& url,
    const blink::mojom::LocalResourceSourcePtr& source,
    const std::string& mime_type) {
  // Get resource.
  std::string path_key = GetWebUIResourcePath(url);
  auto resource_it = source->path_to_resource_map.find(path_key);
  // CanServe should have been called before this point, which would have
  // confirmed that there exists a resource corresponding to the URL path.
  if (resource_it == source->path_to_resource_map.end()) {
    SCOPED_CRASH_KEY_STRING256("Bug470579309", "url", url.spec());
    SCOPED_CRASH_KEY_STRING256("Bug470579309", "path", path_key);
    SCOPED_CRASH_KEY_NUMBER("Bug470579309", "resource_map_size",
                            source->path_to_resource_map.size());
    NOTREACHED();
  }
  if (resource_it->second->is_response_body()) {
    // The resource is a direct response. Note that this should already be
    // handled earlier for callers from `GetResourceAndRespond()`, so this path
    // is only for direct callers for `GetResource()`.
    return base::MakeRefCounted<base::RefCountedString>(
        resource_it->second->get_response_body());
  }

  // Load bytes using a resource ID.
  scoped_refptr<base::RefCountedMemory> raw_bytes =
      GetResourceBytes(resource_it->second);
  // CanServe should have been called before this point, which would have
  // confirmed that the ResourceBundle will return non-null for the given
  // resource ID.
  CHECK(raw_bytes);
  std::string_view bytes(base::as_string_view(*raw_bytes));

  scoped_refptr<base::RefCountedMemory> bytes_after_replacement = raw_bytes;
  if (!source->replacement_strings.empty() &&
      (mime_type == "text/html" || mime_type == "text/css" ||
       (source->should_replace_i18n_in_js && mime_type == "text/javascript"))) {
    auto lookup = [&](const std::string& key) {
      return base::FindOrNull(source->replacement_strings, key);
    };
    std::string replaced_string;
    if (mime_type == "text/javascript") {
      CHECK(ui::ReplaceTemplateExpressionsInJSWithLookup(bytes, lookup,
                                                         &replaced_string));
    } else {
      replaced_string =
          ui::ReplaceTemplateExpressionsWithLookup(bytes, lookup);
    }
    bytes_after_replacement = base::MakeRefCounted<base::RefCountedString>(
        std::move(replaced_string));
  }

  return bytes_after_replacement;
}

}  // namespace content
