// Copyright 2020 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/loader/fetch/url_loader/cached_metadata_handler.h"

#include "base/memory/raw_ptr.h"
#include "base/test/scoped_feature_list.h"
#include "base/test/task_environment.h"
#include "components/persistent_cache/pending_backend.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/public/mojom/fetch/fetch_api_request.mojom-blink.h"
#include "third_party/blink/public/mojom/loader/code_cache.mojom-blink.h"
#include "third_party/blink/public/platform/url_conversion.h"
#include "third_party/blink/public/platform/web_url.h"
#include "third_party/blink/renderer/platform/loader/fetch/code_cache_host.h"
#include "third_party/blink/renderer/platform/loader/fetch/resource_request.h"
#include "third_party/blink/renderer/platform/loader/fetch/resource_response.h"
#include "third_party/blink/renderer/platform/loader/fetch/script_cached_metadata_handler.h"
#include "third_party/blink/renderer/platform/testing/runtime_enabled_features_test_helpers.h"
#include "third_party/blink/renderer/platform/testing/testing_platform_support.h"
#include "third_party/blink/renderer/platform/weborigin/kurl.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {
namespace {

class MockGeneratedCodeCache
    : public network::mojom::blink::CacheStorageSideDataWriter {
 public:
  const Vector<KURL>& CachedURLs() const { return cached_urls_; }
  const mojo_base::BigBuffer& LastWrite() const { return last_write_; }
  size_t CacheStorageWriteCount() const { return cache_storage_write_count_; }

  void CacheMetadata(mojom::CodeCacheType cache_type,
                     const KURL& url,
                     base::Time,
                     mojo_base::BigBuffer data) {
    cached_urls_.push_back(url);
    last_write_ = std::move(data);
  }

  void BindSideDataWriter(ResourceResponse& response) {
    response.SetServiceWorkerResponseSource(
        network::mojom::FetchResponseSource::kCacheStorage);
    mojo::PendingRemote<network::mojom::blink::CacheStorageSideDataWriter>
        writer_remote;
    receivers_.Add(this, writer_remote.InitWithNewPipeAndPassReceiver());
    response.SetCacheStorageSideDataWriter(std::move(writer_remote));
  }

  // network::mojom::blink::CacheStorageSideDataWriter:
  void WriteSideData(mojo_base::BigBuffer data) override {
    ++cache_storage_write_count_;
  }

 private:
  Vector<KURL> cached_urls_;
  mojo_base::BigBuffer last_write_;
  size_t cache_storage_write_count_ = 0;
  mojo::ReceiverSet<network::mojom::blink::CacheStorageSideDataWriter>
      receivers_;
};

class CodeCacheHostMockImpl : public mojom::blink::CodeCacheHost {
 public:
  explicit CodeCacheHostMockImpl(MockGeneratedCodeCache* sim) : sim_(sim) {}

 private:
  // CodeCacheHost implementation.
  void GetPendingBackend(mojom::blink::CodeCacheType cache_type,
                         GetPendingBackendCallback callback) override {
    std::move(callback).Run(std::nullopt);
  }
  void DidGenerateCacheableMetadata(mojom::blink::CodeCacheType cache_type,
                                    const KURL& url,
                                    base::Time expected_response_time,
                                    mojo_base::BigBuffer data) override {
    sim_->CacheMetadata(cache_type, url, expected_response_time,
                        std::move(data));
  }
  void DidGenerateSourceKeyedCacheableMetadata(
      const blink::Vector<uint8_t>& script_hash,
      mojo_base::BigBuffer data) override {}
  void FetchCachedCode(mojom::blink::CodeCacheType cache_type,
                       const KURL& url,
                       FetchCachedCodeCallback) override {}
  void ClearCodeCacheEntry(mojom::blink::CodeCacheType cache_type,
                           const KURL& url) override {}

  raw_ptr<MockGeneratedCodeCache> sim_;
};

ResourceResponse CreateTestResourceResponse() {
  ResourceResponse response(KURL("https://example.com/"));
  response.SetHttpStatusCode(200);
  return response;
}

class CachedMetadataHandlerTest : public testing::Test {
 protected:
  void SendDataFor(const ResourceResponse& response,
                   MockGeneratedCodeCache* disk) {
    constexpr uint8_t kTestData[] = {1, 2, 3, 4, 5};
    std::unique_ptr<CachedMetadataSender> sender = CachedMetadataSender::Create(
        response, mojom::CodeCacheType::kJavascript,
        SecurityOrigin::Create(response.CurrentRequestUrl()));

    std::unique_ptr<mojom::blink::CodeCacheHost> mojo_code_cache_host =
        std::make_unique<CodeCacheHostMockImpl>(disk);
    mojo::Remote<mojom::blink::CodeCacheHost> remote;
    mojo::Receiver<mojom::blink::CodeCacheHost> receiver(
        mojo_code_cache_host.get(), remote.BindNewPipeAndPassReceiver());
    auto code_cache_host = CodeCacheHost::Create(std::move(remote));
    sender->Send(code_cache_host.get(),
                 mojo_base::BigBuffer(base::span(kTestData)));

    // Flush the receiver pipes to process any pending Mojo messages.
    receiver.FlushForTesting();
    task_environment_.RunUntilIdle();
  }

  base::test::SingleThreadTaskEnvironment task_environment_;
};

TEST_F(CachedMetadataHandlerTest, ReleaseLargeConsumedCodeCacheLocally) {
  base::test::ScopedFeatureList feature(kOptimiumReleaseConsumedCodeCache);
  auto* handler = MakeGarbageCollected<ScriptCachedMetadataHandler>(
      Utf8Encoding(), nullptr);
  constexpr uint32_t kType = 1234;
  constexpr wtf_size_t kThreshold = 2 * 1024 * 1024;
  auto load = [&](ScriptCachedMetadataHandler* target, wtf_size_t size) {
    auto bytes = CachedMetadata::GetSerializedDataHeader(
        kType, size - sizeof(CachedMetadataHeader));
    bytes.resize(size);
    target->SetSerializedCachedMetadata(mojo_base::BigBuffer(bytes));
  };
  load(handler, kThreshold);
  auto other_reader = handler->GetCachedMetadata(
      kType, CachedMetadataHandler::kCrashIfUnchecked);
  ASSERT_TRUE(other_reader);
  handler->DidUseCodeCache(/*was_rejected=*/true);
  EXPECT_EQ(handler->GetCodeCacheSize(), kThreshold);
  handler->DidUseCodeCache(/*was_rejected=*/false);
  EXPECT_EQ(handler->GetCodeCacheSize(), 0u);
  EXPECT_EQ(other_reader->SerializedData().size(), kThreshold);

  // A subsequent execution may try to store a new heat-check timestamp.
  constexpr uint8_t kTimestamp[] = {1};
  handler->SetCachedMetadata(nullptr, kType, kTimestamp);
  EXPECT_EQ(handler->GetCodeCacheSize(), 0u);

  auto* small = MakeGarbageCollected<ScriptCachedMetadataHandler>(
      Utf8Encoding(), nullptr);
  load(small, kThreshold - 1);
  small->DidUseCodeCache(/*was_rejected=*/false);
  EXPECT_EQ(small->GetCodeCacheSize(), kThreshold - 1);
}

TEST_F(CachedMetadataHandlerTest, DirectWritePreservesGeneratedCodeCache) {
  base::test::ScopedFeatureList feature(kOptimiumReleaseConsumedCodeCache);
  ResourceResponse response = CreateTestResourceResponse();
  auto* handler = MakeGarbageCollected<ScriptCachedMetadataHandler>(
      Utf8Encoding(),
      CachedMetadataSender::Create(
          response, mojom::CodeCacheType::kJavascript,
          SecurityOrigin::Create(response.CurrentRequestUrl())));
  MockGeneratedCodeCache disk;
  CodeCacheHostMockImpl impl(&disk);
  mojo::Remote<mojom::blink::CodeCacheHost> remote;
  mojo::Receiver<mojom::blink::CodeCacheHost> receiver(
      &impl, remote.BindNewPipeAndPassReceiver());
  auto host = CodeCacheHost::Create(std::move(remote));

  constexpr uint32_t kType = 1234;
  Vector<uint8_t> payload(2 * 1024 * 1024);
  for (wtf_size_t i = 0; i < payload.size(); ++i) {
    payload[i] = static_cast<uint8_t>(i);
  }
  handler->SetGeneratedCodeCache(host.get(), kType, payload);
  EXPECT_EQ(handler->GetCodeCacheSize(), 0u);
  constexpr uint8_t kTimestamp[] = {1};
  handler->SetCachedMetadata(host.get(), kType + 1, kTimestamp);
  receiver.FlushForTesting();
  ASSERT_EQ(disk.CachedURLs().size(), 1u);
  auto expected = CachedMetadata::Create(kType, payload);
  EXPECT_TRUE(base::span(disk.LastWrite()) == expected->SerializedData());
}

TEST_F(CachedMetadataHandlerTest, KeepGeneratedCodeCacheWithoutHost) {
  base::test::ScopedFeatureList feature(kOptimiumReleaseConsumedCodeCache);
  ResourceResponse response = CreateTestResourceResponse();
  auto* handler = MakeGarbageCollected<ScriptCachedMetadataHandler>(
      Utf8Encoding(),
      CachedMetadataSender::Create(
          response, mojom::CodeCacheType::kJavascript,
          SecurityOrigin::Create(response.CurrentRequestUrl())));
  Vector<uint8_t> payload(2 * 1024 * 1024);
  handler->SetGeneratedCodeCache(nullptr, 1234, payload);
  EXPECT_EQ(handler->GetCodeCacheSize(),
            payload.size() + sizeof(CachedMetadataHeader));
}

TEST_F(CachedMetadataHandlerTest, GeneratedCodePreservesHashedFormat) {
  base::test::ScopedFeatureList feature(kOptimiumReleaseConsumedCodeCache);
  ResourceResponse response = CreateTestResourceResponse();
  auto* handler = MakeGarbageCollected<ScriptCachedMetadataHandlerWithHashing>(
      Utf8Encoding(),
      CachedMetadataSender::Create(
          response, mojom::CodeCacheType::kJavascript,
          SecurityOrigin::Create(response.CurrentRequestUrl())));
  MockGeneratedCodeCache disk;
  CodeCacheHostMockImpl impl(&disk);
  mojo::Remote<mojom::blink::CodeCacheHost> remote;
  mojo::Receiver<mojom::blink::CodeCacheHost> receiver(
      &impl, remote.BindNewPipeAndPassReceiver());
  auto host = CodeCacheHost::Create(std::move(remote));
  const ParkableString source(String("function run() { return 1; }").Impl());
  handler->Check(host.get(), source);

  Vector<uint8_t> payload(2 * 1024 * 1024);
  handler->SetGeneratedCodeCache(host.get(), 1234, payload);
  receiver.FlushForTesting();
  EXPECT_EQ(handler->GetCodeCacheSize(),
            payload.size() + sizeof(CachedMetadataHeader));
  auto expected = handler->GetSerializedCachedMetadata();
  EXPECT_GT(expected.size(), handler->GetCodeCacheSize());
  EXPECT_TRUE(base::span(disk.LastWrite()) == base::span(expected));
}

TEST_F(CachedMetadataHandlerTest, SendsMetadataToPlatform) {
  MockGeneratedCodeCache mock_disk_cache;
  ResourceResponse response(CreateTestResourceResponse());

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(1u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(0u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(
    CachedMetadataHandlerTest,
    DoesNotSendMetadataToPlatformWhenFetchedViaServiceWorkerWithSyntheticResponse) {
  MockGeneratedCodeCache mock_disk_cache;

  // Equivalent to service worker calling respondWith(new Response(...))
  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(0u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(
    CachedMetadataHandlerTest,
    SendsMetadataToPlatformWhenFetchedViaServiceWorkerWithPassThroughResponse) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
  MockGeneratedCodeCache mock_disk_cache;

  // Equivalent to service worker calling respondWith(fetch(evt.request.url));
  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker({response.CurrentRequestUrl()});

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(1u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(0u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(
    CachedMetadataHandlerTest,
    DoesNotSendMetadataToPlatformWhenFetchedViaServiceWorkerWithDifferentURLResponse) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
  MockGeneratedCodeCache mock_disk_cache;

  // Equivalent to service worker calling respondWith(fetch(some_different_url))
  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker(
      {KURL("https://example.com/different/url")});

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(0u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(CachedMetadataHandlerTest,
       SendsMetadataToPlatformWhenFetchedViaServiceWorkerWithCacheResponse) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
  MockGeneratedCodeCache mock_disk_cache;

  // Equivalent to service worker calling respondWith(cache.match(some_url));
  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker({response.CurrentRequestUrl()});
  mock_disk_cache.BindSideDataWriter(response);

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(1u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(CachedMetadataHandlerTest,
       DoesNotSendMetadataToPlatformWhenServiceWorkerCodeCacheDisabled) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(false);
  MockGeneratedCodeCache mock_disk_cache;

  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker({response.CurrentRequestUrl()});
  mock_disk_cache.BindSideDataWriter(response);

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(0u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(
    CachedMetadataHandlerTest,
    DoesNotSendMetadataToPlatformWhenFetchedViaServiceWorkerWithSyntheticCacheResponse) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
  MockGeneratedCodeCache mock_disk_cache;

  // Equivalent to service worker calling
  // respondWith(cache.match(synthetic_response));
  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  mock_disk_cache.BindSideDataWriter(response);

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(0u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(
    CachedMetadataHandlerTest,
    DoesNotSendMetadataToPlatformWhenFetchedViaServiceWorkerWithDifferentURLCacheResponse) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
  MockGeneratedCodeCache mock_disk_cache;

  // Equivalent to service worker calling
  // respondWith(cache.match(different_url));
  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker(
      {KURL("https://example.com/different/url")});
  mock_disk_cache.BindSideDataWriter(response);

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(0u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(
    CachedMetadataHandlerTest,
    DoesNotSendMetadataToPlatformWhenFetchedViaServiceWorkerWithUnboundCacheResponse) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
  MockGeneratedCodeCache mock_disk_cache;

  // Equivalent to a kCacheStorage response whose writer was not preserved.
  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker({response.CurrentRequestUrl()});
  response.SetServiceWorkerResponseSource(
      network::mojom::FetchResponseSource::kCacheStorage);

  SendDataFor(response, &mock_disk_cache);
  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(0u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(CachedMetadataHandlerTest,
       DoesNotFallThroughToCodeCacheHostOnRepeatedSendForCacheResponse) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
  MockGeneratedCodeCache mock_disk_cache;

  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker({response.CurrentRequestUrl()});
  mock_disk_cache.BindSideDataWriter(response);

  std::unique_ptr<CachedMetadataSender> sender = CachedMetadataSender::Create(
      response, mojom::CodeCacheType::kWebAssembly,
      SecurityOrigin::Create(response.CurrentRequestUrl()));

  std::unique_ptr<mojom::blink::CodeCacheHost> mojo_code_cache_host =
      std::make_unique<CodeCacheHostMockImpl>(&mock_disk_cache);
  mojo::Remote<mojom::blink::CodeCacheHost> remote;
  mojo::Receiver<mojom::blink::CodeCacheHost> receiver(
      mojo_code_cache_host.get(), remote.BindNewPipeAndPassReceiver());
  auto code_cache_host = CodeCacheHost::Create(std::move(remote));

  constexpr uint8_t kTestData[] = {1, 2, 3, 4, 5};
  sender->Send(code_cache_host.get(), mojo_base::BigBuffer(kTestData));
  sender->Send(code_cache_host.get(), mojo_base::BigBuffer(kTestData));
  task_environment_.RunUntilIdle();

  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(1u, mock_disk_cache.CacheStorageWriteCount());
}

TEST_F(CachedMetadataHandlerTest,
       PreservesCacheStorageWriterAcrossResourceResponseCopyAndTakesSenderOnce) {
  ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
  MockGeneratedCodeCache mock_disk_cache;

  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker({response.CurrentRequestUrl()});
  mock_disk_cache.BindSideDataWriter(response);

  // Copy ResourceResponse before creating the sender (sharing the underlying
  // writer holder).
  ResourceResponse copied_response(response);

  auto* handler = MakeGarbageCollected<ScriptCachedMetadataHandler>(
      Utf8Encoding(),
      CachedMetadataSender::Create(
          copied_response, mojom::CodeCacheType::kWebAssembly,
          SecurityOrigin::Create(copied_response.CurrentRequestUrl())));

  // First consumer takes the sender from the shared handler and writes to
  // CacheStorage.
  std::unique_ptr<CachedMetadataSender> first_sender = handler->TakeSender();
  ASSERT_NE(nullptr, first_sender);

  std::unique_ptr<mojom::blink::CodeCacheHost> mojo_code_cache_host =
      std::make_unique<CodeCacheHostMockImpl>(&mock_disk_cache);
  mojo::Remote<mojom::blink::CodeCacheHost> remote;
  mojo::Receiver<mojom::blink::CodeCacheHost> receiver(
      mojo_code_cache_host.get(), remote.BindNewPipeAndPassReceiver());
  auto code_cache_host = CodeCacheHost::Create(std::move(remote));

  constexpr uint8_t kTestData[] = {1, 2, 3, 4, 5};
  first_sender->Send(code_cache_host.get(), mojo_base::BigBuffer(kTestData));
  task_environment_.RunUntilIdle();

  EXPECT_EQ(0u, mock_disk_cache.CachedURLs().size());
  EXPECT_EQ(1u, mock_disk_cache.CacheStorageWriteCount());

  // Second consumer (e.g. a cloned Response sharing the same handler) gets
  // nullptr from TakeSender().
  EXPECT_EQ(nullptr, handler->TakeSender());

  // Clearing in-memory metadata locally on the handler after the sender was
  // taken remains safe.
  handler->ClearCachedMetadata(/*code_cache_host=*/nullptr,
                               CachedMetadataHandler::kClearLocally);
}

TEST_F(CachedMetadataHandlerTest,
       ShouldUseIsolatedCodeCacheRespectsServiceWorkerCodeCacheFlag) {
  ResourceResponse response(CreateTestResourceResponse());
  response.SetWasFetchedViaServiceWorker(true);
  response.SetUrlListViaServiceWorker({response.CurrentRequestUrl()});

  {
    ScopedServiceWorkerCodeCacheForTest scoped_feature(false);
    EXPECT_FALSE(ShouldUseIsolatedCodeCache(
        mojom::blink::RequestContextType::SCRIPT, response));
  }
  {
    ScopedServiceWorkerCodeCacheForTest scoped_feature(true);
    EXPECT_TRUE(ShouldUseIsolatedCodeCache(
        mojom::blink::RequestContextType::SCRIPT, response));
  }
}

}  // namespace
}  // namespace blink
