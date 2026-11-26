// Copyright 2014 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/gl/gl_enums.h"

#include <GLES2/gl2.h>

#include <algorithm>
#include <iterator>
#include <sstream>
#include <string_view>

#include "ui/gl/gl_enums_implementation_autogen.h"

namespace gl {

std::string GLEnums::GetStringEnum(uint32_t value) {
  const auto* entry = std::ranges::lower_bound(kEnumToStringTable, value, {},
                                               &EnumToString::value);
  if (entry != std::end(kEnumToStringTable) && entry->value == value) {
    constexpr std::string_view names(kEnumNames, sizeof(kEnumNames) - 1);
    return std::string(names.substr(entry->name_offset, entry->name_length));
  }
  std::stringstream ss;
  ss.fill('0');
  ss.width(value < 0x10000 ? 4 : 8);
  ss << std::hex << value;
  return "0x" + ss.str();
}

std::string GLEnums::GetStringError(uint32_t value) {
  if (value == GL_NONE)
    return "GL_NONE";
  return GetStringEnum(value);
}

std::string GLEnums::GetStringBool(uint32_t value) {
  return value ? "GL_TRUE" : "GL_FALSE";
}

}  // namespace gl
