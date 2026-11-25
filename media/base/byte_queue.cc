// Copyright 2011 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "media/base/byte_queue.h"

#include <algorithm>
#include <cstring>

#include "base/check_op.h"
#include "base/compiler_specific.h"
#include "base/containers/heap_array.h"
#include "base/numerics/checked_math.h"
#include "base/process/memory.h"

namespace media {
namespace {
// Default starting size for the queue.
constexpr size_t kDefaultQueueSize = 1024;
// Keep ordinary segment storage warm. Reclaim a large high-water mark when
// the parser is flushed or a subsequent append needs at most 1/8 of it.
constexpr size_t kLargeQueueSize = 1024 * 1024;

base::HeapArray<uint8_t, base::UncheckedFreeDeleter> MallocHeapArray(
    size_t size) {
  uint8_t* new_buffer_ptr = nullptr;
  if (!base::UncheckedMalloc(size, reinterpret_cast<void**>(&new_buffer_ptr)) ||
      !new_buffer_ptr) {
    return {};
  }

  // SAFETY: `base::UncheckedMalloc` returns a null pointer when the allocation
  // fails. But the above if has already checked the null pointer case. So we
  // can assume it is safe.
  return UNSAFE_BUFFERS(
      base::HeapArray<uint8_t, base::UncheckedFreeDeleter>::FromOwningPointer(
          new_buffer_ptr, size));
}

}  // namespace

ByteQueue::ByteQueue() = default;

ByteQueue::~ByteQueue() = default;

void ByteQueue::Reset() {
  offset_ = 0;
  data_ = {};
  if (buffer_.size() >= kLargeQueueSize) {
    buffer_ = {};
  }
}

bool ByteQueue::Push(base::span<const uint8_t> data) {
  DCHECK(!data.empty());

  size_t size_needed;
  if (!base::CheckAdd(data_.size(), data.size()).AssignIfValid(&size_needed)) {
    return false;
  }
  const size_t capacity = buffer_.size();
  const bool grow = size_needed > capacity;
  // Resize on append, not on every drain. Repeated large segments can reuse
  // the same allocation. Include any unparsed suffix in the size decision.
  const bool shrink =
      capacity >= kLargeQueueSize && size_needed <= capacity / 8;
  if (grow || shrink) {
    size_t target = std::max(kDefaultQueueSize, size_needed);
    if (grow) {
      const size_t expanded =
          base::CheckAdd(capacity, capacity / 4).ValueOrDefault(size_needed);
      target = std::max(target, expanded);
    }
    auto next = MallocHeapArray(target);
    if (!next.empty()) {
      auto live = next.first(data_.size());
      if (!live.empty()) {
        live.copy_from_nonoverlapping(data_);
      }
      data_ = live;
      buffer_ = std::move(next);
      offset_ = 0;
    } else if (grow) {
      return false;
    }
    // Shrinking is optional. On allocation failure keep using the old buffer.
  }
  if (size_needed > buffer_.size() - offset_) {
    buffer_.copy_prefix_from(data_);
    offset_ = 0;
  }

  buffer_.subspan(offset_ + data_.size()).copy_prefix_from(data);
  data_ = buffer_.subspan(offset_, size_needed);

  return true;
}

void ByteQueue::Pop(int count) {
  DCHECK_LE(base::checked_cast<size_t>(count), data_.size());

  offset_ += count;
  data_ = data_.subspan(base::checked_cast<size_t>(count));

  if (data_.empty()) {
    data_ = {};
    offset_ = 0;
  }
}

}  // namespace media
