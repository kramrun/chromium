// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/core/loader/resource/text_resource.h"

#include <string>

#include "base/containers/span.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/renderer/core/loader/resource/css_style_sheet_resource.h"
#include "third_party/blink/renderer/platform/testing/task_environment.h"
#include "third_party/blink/renderer/platform/weborigin/kurl.h"
#include "third_party/blink/renderer/platform/wtf/text/text_encoding.h"

namespace blink {
namespace {

TEST(TextResourceTest, LargeNarrowSegments) {
  test::TaskEnvironment task_environment;
  auto* resource = CSSStyleSheetResource::CreateForTest(
      KURL("https://example.test/basic.css"), Utf8Encoding());
  const std::string first(300 * 1024, 'a');
  const std::string second(300 * 1024, 'b');
  resource->AppendData(base::span<const char>(first));
  resource->AppendData(base::span<const char>(second));

  const String result = resource->DecodedText();
  EXPECT_TRUE(result.Is8Bit());
  EXPECT_TRUE(result == String::FromUtf8(first + second));
}

TEST(TextResourceTest, LargeSegmentsSplitCodePointAndFlush) {
  test::TaskEnvironment task_environment;
  auto* resource = CSSStyleSheetResource::CreateForTest(
      KURL("https://example.test/mixed.css"), Utf8Encoding());
  const std::string ascii(320 * 1024, 'x');
  // Split a supplementary character between segments, then end the stream
  // inside another sequence so the decoder also produces output at Flush().
  const std::string first = ascii + "\xf0\x9f";
  const std::string second = "\x8c\x8c" + ascii + "\xe2\x82";
  resource->AppendData(base::span<const char>(first));
  resource->AppendData(base::span<const char>(second));

  const String expected =
      String::FromUtf8(ascii + "\xf0\x9f\x8c\x8c" + ascii + "\xef\xbf\xbd");
  const String result = resource->DecodedText();
  EXPECT_FALSE(result.Is8Bit());
  EXPECT_TRUE(result == expected);
}

}  // namespace
}  // namespace blink
