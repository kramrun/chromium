// Copyright 2017 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "media/base/frame_buffer_pool.h"

#include <inttypes.h>

#include <algorithm>
#include <utility>
#include <vector>

#include "base/check_op.h"
#include "base/containers/heap_array.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/process/memory.h"
#include "base/strings/stringprintf.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/task/thread_pool/thread_pool_instance.h"
#include "base/time/time.h"
#include "base/trace_event/memory_allocator_dump.h"
#include "base/trace_event/memory_dump_manager.h"
#include "base/trace_event/process_memory_dump.h"

namespace media {

using BytesArray = base::HeapArray<uint8_t, base::UncheckedFreeDeleter>;

// Helper class to allow thread safe memory dumping without a task runner.
class FrameBufferPool::FrameBufferMemoryDumpProviderImpl
    : public base::trace_event::MemoryDumpProvider {
 public:
  explicit FrameBufferMemoryDumpProviderImpl(
      scoped_refptr<FrameBufferPool> pool)
      : pool_(std::move(pool)) {
    DCHECK(pool_);
    base::trace_event::MemoryDumpManager::GetInstance()->RegisterDumpProvider(
        this, "FrameBufferPool", nullptr);
  }

  ~FrameBufferMemoryDumpProviderImpl() override = default;

  // base::MemoryDumpProvider implementation.
  bool OnMemoryDump(const base::trace_event::MemoryDumpArgs& args,
                    base::trace_event::ProcessMemoryDump* pmd) override {
    return pool_->OnMemoryDump(args, pmd);
  }

 private:
  scoped_refptr<FrameBufferPool> pool_;
};

struct FrameBufferPool::FrameBuffer {
  // Not using std::vector<uint8_t> as resize() calls take a really long time
  // for large buffers.
  BytesArray data;
  bool held_by_library = false;
  // Needs to be a counter since a frame buffer might be used multiple times.
  int held_by_frame = 0;
  base::TimeTicks last_use_time;
  base::TimeTicks small_requests_since;
  size_t largest_small_request = 0;
};

namespace {

constexpr auto kIdleTimeout =
    base::Seconds(std::to_underlying(FrameBufferPool::kStaleFrameLimitSecs));

BytesArray AllocateMemory(size_t min_size,
                          bool zero_initialize,
                          bool force_error) {
  if (force_error) {
    return {};
  }

  uint8_t* data = nullptr;
  const bool result =
      zero_initialize
          ? base::UncheckedCalloc(1u, min_size, reinterpret_cast<void**>(&data))
          : base::UncheckedMalloc(min_size, reinterpret_cast<void**>(&data));

  // Unclear why, but the docs indicate both that `data` will be null on
  // failure, and also that the return value must not be discarded.
  if (!result || !data) {
    return {};
  }

  // SAFETY: We have just allocated `min_size` of memory for `data`.
  return UNSAFE_BUFFERS(BytesArray::FromOwningPointer(data, min_size));
}

}  // namespace

FrameBufferPool::FrameBufferPool(bool zero_initialize_memory)
    : zero_initialize_memory_(zero_initialize_memory),
      tick_clock_(base::DefaultTickClock::GetInstance()) {}

FrameBufferPool::~FrameBufferPool() {
  base::AutoLock lock(lock_);
  DCHECK(in_shutdown_);

  // May be destructed on any thread.
}

base::span<uint8_t> FrameBufferPool::GetFrameBuffer(size_t min_size,
                                                    void** fb_priv) {
  base::AutoLock lock(lock_);
  DCHECK(!in_shutdown_);

  if (!memory_dump_impl_) {
    memory_dump_impl_ =
        std::make_unique<FrameBufferMemoryDumpProviderImpl>(this);
  }

  // A resolution change can leave free buffers of several sizes. Reuse the
  // smallest one that fits. If all are too small, growing the largest keeps
  // the total capacity of the remaining buffers as low as possible.
  const auto end = frame_buffers_.end();
  auto fit = end;
  auto grow = end;
  for (auto candidate = frame_buffers_.begin(); candidate != end; ++candidate) {
    if (IsUsedLocked(candidate->get())) {
      continue;
    }
    const size_t size = (*candidate)->data.size();
    if (size >= min_size) {
      if (fit == end || size < (*fit)->data.size()) {
        fit = candidate;
        if (size == min_size) {
          break;
        }
      }
    } else if (grow == end || size > (*grow)->data.size()) {
      grow = candidate;
    }
  }

  auto it = fit != end ? fit : grow;
  if (it == end) {
    it = frame_buffers_.insert(it, std::make_unique<FrameBuffer>());
  }

  auto& frame_buffer = *it;

  // Resize the frame buffer if necessary.
  frame_buffer->held_by_library = true;
  // A decoder can keep reusing a 4K allocation for smaller frames forever:
  // each release refreshes last_use_time, so the idle eviction never sees it.
  // Size the replacement for the largest request in a sustained smaller run.
  const size_t capacity = frame_buffer->data.size();
  if (min_size > 0 && min_size <= capacity / 2 &&
      capacity - min_size >= 1024 * 1024) {
    const base::TimeTicks now = tick_clock_->NowTicks();
    if (!frame_buffer->largest_small_request) {
      frame_buffer->small_requests_since = now;
    }
    frame_buffer->largest_small_request =
        std::max(frame_buffer->largest_small_request, min_size);
    if (now - frame_buffer->small_requests_since >= kIdleTimeout) {
      // If the optional allocation fails, the existing buffer is still usable.
      auto smaller =
          AllocateMemory(frame_buffer->largest_small_request,
                         zero_initialize_memory_, force_allocation_error_);
      if (!smaller.empty()) {
        frame_buffer->data = std::move(smaller);
      }
      frame_buffer->largest_small_request = 0;
    }
  } else {
    frame_buffer->largest_small_request = 0;
  }
  if (frame_buffer->data.size() < min_size) {
    // Free the existing |data| first so that the memory can be reused,
    // if possible.
    frame_buffer->data = {};
    frame_buffer->data = AllocateMemory(min_size, zero_initialize_memory_,
                                        force_allocation_error_);

    if (frame_buffer->data.empty()) {
      frame_buffers_.erase(it);
      return {};
    }
  }

  // Provide the client with a private identifier.
  *fb_priv = frame_buffer.get();
  return frame_buffer->data;
}

void FrameBufferPool::ReleaseFrameBuffer(void* fb_priv) {
  base::AutoLock lock(lock_);
  DCHECK(fb_priv);

  // Note: The library may invoke this method multiple times for the same frame,
  // so we can't DCHECK that |held_by_library| is true.
  auto* frame_buffer = static_cast<FrameBuffer*>(fb_priv);
  if (!frame_buffer->held_by_library) {
    return;
  }
  frame_buffer->held_by_library = false;
  MarkUnusedLocked(frame_buffer);
}

base::OnceClosure FrameBufferPool::CreateFrameCallback(void* fb_priv) {
  base::AutoLock lock(lock_);

  auto* frame_buffer = static_cast<FrameBuffer*>(fb_priv);
  ++frame_buffer->held_by_frame;

  return base::BindOnce(&FrameBufferPool::OnVideoFrameDestroyed, this,
                        frame_buffer);
}

bool FrameBufferPool::OnMemoryDump(
    const base::trace_event::MemoryDumpArgs& args,
    base::trace_event::ProcessMemoryDump* pmd) {
  base::AutoLock lock(lock_);

  if (in_shutdown_) {
    return false;
  }

  base::trace_event::MemoryAllocatorDump* memory_dump =
      pmd->CreateAllocatorDump(
          base::StringPrintf("media/frame_buffers/memory_pool/0x%" PRIXPTR,
                             reinterpret_cast<uintptr_t>(this)));
  base::trace_event::MemoryAllocatorDump* used_memory_dump =
      pmd->CreateAllocatorDump(
          base::StringPrintf("media/frame_buffers/memory_pool/used/0x%" PRIXPTR,
                             reinterpret_cast<uintptr_t>(this)));

  auto* pool_name = base::trace_event::MemoryDumpManager::GetInstance()
                        ->system_allocator_pool_name();
  if (pool_name) {
    pmd->AddSuballocation(memory_dump->guid(), pool_name);
  }
  size_t bytes_used = 0;
  size_t bytes_reserved = 0;
  for (const auto& frame_buffer : frame_buffers_) {
    if (IsUsedLocked(frame_buffer.get())) {
      bytes_used += frame_buffer->data.size();
    }
    bytes_reserved += frame_buffer->data.size();
  }

  memory_dump->AddScalar(base::trace_event::MemoryAllocatorDump::kNameSize,
                         base::trace_event::MemoryAllocatorDump::kUnitsBytes,
                         bytes_reserved);
  used_memory_dump->AddScalar(
      base::trace_event::MemoryAllocatorDump::kNameSize,
      base::trace_event::MemoryAllocatorDump::kUnitsBytes, bytes_used);

  return true;
}

void FrameBufferPool::Shutdown() {
  base::AutoLock lock(lock_);
  in_shutdown_ = true;

  // Hand over our dump implementation to the manager for eventual deletion.
  if (memory_dump_impl_) {
    base::trace_event::MemoryDumpManager::GetInstance()
        ->UnregisterAndDeleteDumpProviderSoon(std::move(memory_dump_impl_));
  }

  // Clear any refs held by the library which isn't good about cleaning up after
  // itself. This is safe since the library has already been shutdown by this
  // point.
  for (const auto& frame_buffer : frame_buffers_)
    frame_buffer->held_by_library = false;

  EraseUnusedResourcesLocked();
}

// static
bool FrameBufferPool::IsUsedLocked(const FrameBuffer* buf) {
  // Static, so can't check that `lock_` is acquired.
  return buf->held_by_library || buf->held_by_frame > 0;
}

void FrameBufferPool::EraseUnusedResourcesLocked() {
  lock_.AssertAcquired();
  std::erase_if(frame_buffers_, [](const std::unique_ptr<FrameBuffer>& buf) {
    return !IsUsedLocked(buf.get());
  });
}

void FrameBufferPool::OnVideoFrameDestroyed(FrameBuffer* frame_buffer) {
  base::AutoLock lock(lock_);
  DCHECK_GT(frame_buffer->held_by_frame, 0);
  --frame_buffer->held_by_frame;

  if (in_shutdown_) {
    // If we're in shutdown we can be sure that the library has been destroyed.
    EraseUnusedResourcesLocked();
    return;
  }

  MarkUnusedLocked(frame_buffer);
}

void FrameBufferPool::MarkUnusedLocked(FrameBuffer* buffer) {
  if (IsUsedLocked(buffer) || buffer->data.empty()) {
    return;
  }
  const auto now = tick_clock_->NowTicks();
  buffer->last_use_time = now;
  if (trim_pending_) {
    return;
  }
  // Codecs can return buffers on library threads without a current sequenced
  // task runner. Synchronous embedders can also operate without a ThreadPool.
  if (base::ThreadPoolInstance::Get()) {
    ScheduleTrimLocked();
  } else {
    TrimIdleBuffersLocked(now);
  }
}

void FrameBufferPool::ScheduleTrimLocked() {
  trim_pending_ = base::ThreadPool::PostDelayedTask(
      FROM_HERE, {base::TaskPriority::BEST_EFFORT},
      base::BindOnce(&FrameBufferPool::TrimIdleBuffers, this), kIdleTimeout);
}

void FrameBufferPool::TrimIdleBuffers() {
  base::AutoLock lock(lock_);
  trim_pending_ = false;
  // Shutdown releases unused allocations immediately. The last queued task
  // may outlive the decoder and its test clock.
  if (!in_shutdown_ && TrimIdleBuffersLocked(tick_clock_->NowTicks())) {
    ScheduleTrimLocked();
  }
}

bool FrameBufferPool::TrimIdleBuffersLocked(base::TimeTicks now) {
  bool has_recently_returned_buffers = false;
  for (auto& buffer : frame_buffers_) {
    if (IsUsedLocked(buffer.get()) || buffer->data.empty()) {
      continue;
    }
    if (now - buffer->last_use_time < kIdleTimeout) {
      has_recently_returned_buffers = true;
      continue;
    }
    // The codec can return an opaque handle more than once. Keep the small
    // handle valid and available for reuse while releasing the pixel storage.
    buffer->data = {};
    buffer->largest_small_request = 0;
  }
  return has_recently_returned_buffers;
}

size_t FrameBufferPool::get_pool_size_for_testing() const {
  base::AutoLock lock(lock_);
  return std::ranges::count_if(frame_buffers_, [](const auto& buffer) {
    return !buffer->data.empty();
  });
}

}  // namespace media
