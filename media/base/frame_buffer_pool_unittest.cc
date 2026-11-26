// Copyright 2017 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "media/base/frame_buffer_pool.h"

#include <algorithm>
#include <utility>

#include "base/compiler_specific.h"
#include "base/functional/callback.h"
#include "base/test/simple_test_tick_clock.h"
#include "base/test/task_environment.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace media {

constexpr size_t kBufferSize = 1024;

TEST(FrameBufferPool, BasicFunctionality) {
  auto pool = base::MakeRefCounted<FrameBufferPool>();

  void* priv1 = nullptr;
  auto buf1 = pool->GetFrameBuffer(kBufferSize, &priv1);
  ASSERT_FALSE(buf1.empty());
  ASSERT_TRUE(priv1);
  std::ranges::fill(buf1, 0);

  void* priv2 = nullptr;
  auto buf2 = pool->GetFrameBuffer(kBufferSize, &priv2);
  ASSERT_TRUE(priv2);
  ASSERT_FALSE(buf2.empty());
  EXPECT_NE(priv1, priv2);
  EXPECT_NE(buf1.data(), buf2.data());
  std::ranges::fill(buf2, 0);

  EXPECT_EQ(2u, pool->get_pool_size_for_testing());

  // Frames are not released immediately, so this should still show two frames.
  pool->ReleaseFrameBuffer(priv2);
  priv2 = nullptr;
  EXPECT_EQ(2u, pool->get_pool_size_for_testing());

  auto frame_release_cb = pool->CreateFrameCallback(priv1);

  // Shutdown should release all memory that's not held by VideoFrames.
  pool->Shutdown();
  EXPECT_EQ(1u, pool->get_pool_size_for_testing());

  std::ranges::fill(buf1, 0);

  // This will release all memory since we're in the shutdown state.
  std::move(frame_release_cb).Run();
  EXPECT_EQ(0u, pool->get_pool_size_for_testing());
}

TEST(FrameBufferPool, ForceAllocationError) {
  auto pool = base::MakeRefCounted<FrameBufferPool>();

  pool->force_allocation_error_for_testing();

  void* priv1 = nullptr;
  auto buf1 = pool->GetFrameBuffer(kBufferSize, &priv1);
  ASSERT_FALSE(priv1);
  ASSERT_TRUE(buf1.empty());
  pool->Shutdown();
}

TEST(FrameBufferPool, DeferredDestruction) {
  base::test::TaskEnvironment tasks(
      base::test::TaskEnvironment::TimeSource::MOCK_TIME);
  auto pool = base::MakeRefCounted<FrameBufferPool>();
  pool->set_tick_clock_for_testing(tasks.GetMockTickClock());

  void* priv1 = nullptr;
  auto buf1 = pool->GetFrameBuffer(kBufferSize, &priv1);
  void* priv2 = nullptr;
  auto buf2 = pool->GetFrameBuffer(kBufferSize, &priv2);
  void* priv3 = nullptr;
  auto buf3 = pool->GetFrameBuffer(kBufferSize, &priv3);
  EXPECT_EQ(3u, pool->get_pool_size_for_testing());

  auto frame_release_cb = pool->CreateFrameCallback(priv1);
  pool->ReleaseFrameBuffer(priv1);
  priv1 = nullptr;
  buf1 = {};
  std::move(frame_release_cb).Run();

  // Frame buffers should not be immediately deleted upon return.
  EXPECT_EQ(3u, pool->get_pool_size_for_testing());

  // Advance some time, but not enough to trigger expiration.
  tasks.FastForwardBy(base::Seconds(FrameBufferPool::kStaleFrameLimitSecs / 2));

  // We should still have 3 frame buffers in the pool at this point.
  frame_release_cb = pool->CreateFrameCallback(priv2);
  pool->ReleaseFrameBuffer(priv2);
  priv2 = nullptr;
  buf2 = {};
  std::move(frame_release_cb).Run();
  EXPECT_EQ(3u, pool->get_pool_size_for_testing());

  tasks.FastForwardBy(base::Seconds(2 * FrameBufferPool::kStaleFrameLimitSecs));

  // Only the most recently released frame should remain now.
  frame_release_cb = pool->CreateFrameCallback(priv3);
  pool->ReleaseFrameBuffer(priv3);
  priv3 = nullptr;
  buf3 = {};
  std::move(frame_release_cb).Run();
  EXPECT_EQ(1u, pool->get_pool_size_for_testing());

  pool->Shutdown();
}

TEST(FrameBufferPool, IdleTrimKeepsCodecHandlesAndReferencedStorage) {
  base::test::TaskEnvironment tasks(
      base::test::TaskEnvironment::TimeSource::MOCK_TIME);
  auto pool = base::MakeRefCounted<FrameBufferPool>(true);
  void* free = nullptr;
  void* codec_owned = nullptr;
  void* frame_owned = nullptr;
  ASSERT_EQ(kBufferSize, pool->GetFrameBuffer(kBufferSize, &free).size());
  auto decode = pool->GetFrameBuffer(kBufferSize, &codec_owned);
  auto display = pool->GetFrameBuffer(kBufferSize, &frame_owned);
  ASSERT_FALSE(decode.empty());
  ASSERT_FALSE(display.empty());
  decode.front() = 12;
  display.front() = 34;
  auto displayed = pool->CreateFrameCallback(frame_owned);
  pool->ReleaseFrameBuffer(frame_owned);
  pool->ReleaseFrameBuffer(free);
  tasks.FastForwardBy(base::Minutes(1));
  EXPECT_EQ(2u, pool->get_pool_size_for_testing());
  EXPECT_EQ(12, decode.front());
  EXPECT_EQ(34, display.front());

  pool->ReleaseFrameBuffer(free);
  void* reused = nullptr;
  auto fresh = pool->GetFrameBuffer(kBufferSize, &reused);
  ASSERT_EQ(kBufferSize, fresh.size());
  EXPECT_EQ(free, reused);
  EXPECT_EQ(0, fresh.front());
  pool->ReleaseFrameBuffer(reused);
  pool->ReleaseFrameBuffer(codec_owned);
  pool->Shutdown();
  EXPECT_EQ(1u, pool->get_pool_size_for_testing());
  tasks.FastForwardBy(base::Minutes(1));
  EXPECT_EQ(34, display.front());
  std::move(displayed).Run();
  EXPECT_EQ(0u, pool->get_pool_size_for_testing());
}

TEST(FrameBufferPool, ReacquiringBeforeSweepRenewsIdlePeriod) {
  base::test::TaskEnvironment tasks(
      base::test::TaskEnvironment::TimeSource::MOCK_TIME);
  auto pool = base::MakeRefCounted<FrameBufferPool>();
  constexpr auto grace =
      base::Seconds(std::to_underlying(FrameBufferPool::kStaleFrameLimitSecs));
  void* handle = nullptr;
  ASSERT_EQ(kBufferSize, pool->GetFrameBuffer(kBufferSize, &handle).size());
  pool->ReleaseFrameBuffer(handle);
  tasks.FastForwardBy(grace / 2);
  void* current = nullptr;
  ASSERT_EQ(kBufferSize, pool->GetFrameBuffer(kBufferSize, &current).size());
  EXPECT_EQ(handle, current);
  pool->ReleaseFrameBuffer(current);
  tasks.FastForwardBy(grace / 2);
  EXPECT_EQ(1u, pool->get_pool_size_for_testing());
  tasks.FastForwardBy(grace);
  EXPECT_EQ(0u, pool->get_pool_size_for_testing());
  pool->Shutdown();
}

TEST(FrameBufferPool, ShrinksFreeBufferAfterSustainedSmallerRequests) {
  constexpr size_t kMiB = 1024 * 1024;
  base::SimpleTestTickClock clock;
  auto pool = base::MakeRefCounted<FrameBufferPool>();
  pool->set_tick_clock_for_testing(&clock);
  auto acquire_and_release = [&](size_t requested) {
    void* priv = nullptr;
    size_t size = pool->GetFrameBuffer(requested, &priv).size();
    if (priv) {
      pool->ReleaseFrameBuffer(priv);
    }
    return size;
  };

  EXPECT_EQ(8 * kMiB, acquire_and_release(8 * kMiB));
  EXPECT_EQ(8 * kMiB, acquire_and_release(kMiB));
  clock.Advance(base::Minutes(1));
  // A return to the original size cancels the pending shrink.
  EXPECT_EQ(8 * kMiB, acquire_and_release(8 * kMiB));
  EXPECT_EQ(8 * kMiB, acquire_and_release(2 * kMiB));
  clock.Advance(base::Minutes(1));
  EXPECT_EQ(2 * kMiB, acquire_and_release(kMiB));

  EXPECT_EQ(2 * kMiB, acquire_and_release(kMiB));
  clock.Advance(base::Minutes(1));
  pool->force_allocation_error_for_testing();
  EXPECT_EQ(2 * kMiB, acquire_and_release(kMiB));
  pool->Shutdown();
}

TEST(FrameBufferPool, ReusesClosestFreeCapacityDuringResolutionChanges) {
  auto pool = base::MakeRefCounted<FrameBufferPool>();
  void* small = nullptr;
  void* large = nullptr;
  void* medium = nullptr;
  ASSERT_EQ(1024u, pool->GetFrameBuffer(1024, &small).size());
  ASSERT_EQ(8192u, pool->GetFrameBuffer(8192, &large).size());
  ASSERT_EQ(4096u, pool->GetFrameBuffer(4096, &medium).size());
  auto rendering = pool->CreateFrameCallback(medium);
  pool->ReleaseFrameBuffer(small);
  pool->ReleaseFrameBuffer(large);
  pool->ReleaseFrameBuffer(medium);

  // The closer match is still being displayed. The larger existing buffer
  // satisfies the request even if no further allocation can be made.
  pool->force_allocation_error_for_testing();
  void* reused = nullptr;
  EXPECT_EQ(8192u, pool->GetFrameBuffer(3072, &reused).size());
  EXPECT_EQ(large, reused);
  if (reused) {
    pool->ReleaseFrameBuffer(reused);
  }
  std::move(rendering).Run();

  reused = nullptr;
  EXPECT_EQ(4096u, pool->GetFrameBuffer(3072, &reused).size());
  EXPECT_EQ(medium, reused);
  pool->Shutdown();
}

TEST(FrameBufferPool, GrowsLargestUndersizedFreeBuffer) {
  auto pool = base::MakeRefCounted<FrameBufferPool>();
  void* small = nullptr;
  void* large = nullptr;
  ASSERT_EQ(1024u, pool->GetFrameBuffer(1024, &small).size());
  ASSERT_EQ(4096u, pool->GetFrameBuffer(4096, &large).size());
  pool->ReleaseFrameBuffer(small);
  pool->ReleaseFrameBuffer(large);

  void* grown = nullptr;
  EXPECT_EQ(8192u, pool->GetFrameBuffer(8192, &grown).size());
  EXPECT_EQ(large, grown);
  void* reused = nullptr;
  EXPECT_EQ(1024u, pool->GetFrameBuffer(1024, &reused).size());
  EXPECT_EQ(small, reused);
  pool->Shutdown();
}

TEST(FrameBufferPool, DoesClearAllocations) {
  auto pool = base::MakeRefCounted<FrameBufferPool>(
      /*zero_initialize_memory=*/true);

  // Certainly this is not foolproof, but even flaky failures here indicate that
  // something is broken.
  void* priv1 = nullptr;
  auto buf = pool->GetFrameBuffer(kBufferSize, &priv1);
  bool nonzero = false;
  for (size_t i = 0; i < kBufferSize; i++) {
    nonzero |= !!buf[i];
  }
  EXPECT_FALSE(nonzero);

  pool->Shutdown();
}

}  // namespace media
