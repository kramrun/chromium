// Copyright 2014 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/core/loader/resource/text_resource.h"

#include <utility>

#include "base/numerics/checked_math.h"
#include "third_party/blink/renderer/core/html/parser/text_resource_decoder.h"
#include "third_party/blink/renderer/platform/loader/fetch/text_resource_decoder_options.h"
#include "third_party/blink/renderer/platform/wtf/shared_buffer.h"
#include "third_party/blink/renderer/platform/wtf/text/string_builder.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {
namespace {

// The decoder may change character width between network chunks. Size the
// final immutable string after the last chunk and flush have been decoded.
String JoinDecodedSegments(const SharedBuffer& data,
                           TextResourceDecoder& decoder) {
  Vector<String, 8> pieces;
  base::CheckedNumeric<wtf_size_t> length = 0;
  bool narrow = true;
  auto append = [&](String piece) {
    if (piece.empty()) {
      return;
    }
    length += piece.length();
    narrow &= piece.Is8Bit();
    pieces.push_back(std::move(piece));
  };
  for (const auto& bytes : data) {
    append(decoder.Decode(bytes));
  }
  append(decoder.Flush());

  if (pieces.empty()) {
    return g_empty_string;
  }
  if (pieces.size() == 1) {
    return std::move(pieces.front());
  }
  if (narrow) {
    base::span<LChar> out;
    String result = String::CreateUninitialized(length.ValueOrDie(), out);
    for (String& part : pieces) {
      out.take_first(part.length()).copy_from(part.Span8());
      part = String();
    }
    return result;
  }
  base::span<UChar> out;
  String result = String::CreateUninitialized(length.ValueOrDie(), out);
  for (String& part : pieces) {
    part.CopyTo(out.take_first(part.length()), 0);
    part = String();
  }
  return result;
}

}  // namespace


TextResource::TextResource(const ResourceRequest& resource_request,
                           ResourceType type,
                           const ResourceLoaderOptions& options,
                           const TextResourceDecoderOptions& decoder_options)
    : Resource(resource_request, type, options),
      decoder_(std::make_unique<TextResourceDecoder>(decoder_options)) {}

TextResource::~TextResource() = default;

void TextResource::SetEncoding(const String& chs) {
  decoder_->SetEncoding(TextEncoding(chs),
                        TextResourceDecoder::kEncodingFromHTTPHeader);
}

TextEncoding TextResource::Encoding() const {
  return decoder_->Encoding();
}

String TextResource::DecodedText() const {
  DCHECK(Data());

  // Avoid retaining many tiny decoded chunks on fragmented responses.
  constexpr size_t kMinBytes = 512 * 1024;
  constexpr size_t kMinAverageSegmentBytes = 2 * 1024;
  const size_t count = Data()->GetSegmentCount();
  if (Data()->size() >= kMinBytes && count > 1 &&
      Data()->size() / count >= kMinAverageSegmentBytes) {
    return JoinDecodedSegments(*Data(), *decoder_);
  }

  StringBuilder builder;
  for (const auto& span : *Data())
    builder.Append(decoder_->Decode(span));
  builder.Append(decoder_->Flush());
  return builder.ToString();
}

}  // namespace blink
