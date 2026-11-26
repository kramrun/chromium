// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_CSS_STYLE_SHEET_TEXT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_CSS_STYLE_SHEET_TEXT_H_

#include <variant>

#include "third_party/blink/renderer/platform/bindings/parkable_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// The resource and deferred declarations share an immutable source snapshot.
// A plain string keeps small and inline styles off the parking manager.
class StyleSheetText {
 public:
  StyleSheetText() = default;
  explicit StyleSheetText(const String& text) : text_(text) {}
  explicit StyleSheetText(const ParkableString& text) : text_(text) {}

  const ParkableString* Parkable() const {
    return std::get_if<ParkableString>(&text_);
  }

  String Get() const {
    if (const auto* parked = Parkable()) {
      return parked->ToString();
    }
    return std::get<String>(text_);
  }

  size_t CharactersSizeInBytes() const {
    if (const auto* parked = Parkable()) {
      return parked->CharactersSizeInBytes();
    }
    return std::get<String>(text_).CharactersSizeInBytes();
  }

  bool IsNull() const {
    return !Parkable() && std::get<String>(text_).IsNull();
  }

 private:
  std::variant<String, ParkableString> text_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_CSS_STYLE_SHEET_TEXT_H_
