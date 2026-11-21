// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Print the module embedded in content/browser/webrtc/resources/data_series.js.
// Uses the builder from this checkout so no external toolchain is needed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const builder = path.resolve(__dirname, '../../v8/test/mjsunit/wasm/wasm-module-builder.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(builder, 'utf8'), context);

function buildSeriesModule() {
  const module = new WasmModuleBuilder();
  for (const [name, element] of [['I32', kWasmI32], ['F64', kWasmF64]]) {
    const array = module.addArray(element, {mutable: true, final: true});
    const ref = wasmRefType(array);
    module.addFunction(undefined, makeSig([element, kWasmI32], [ref]))
        .addBody([kExprLocalGet, 0, kExprLocalGet, 1, kGCPrefix, kExprArrayNew, array])
        .exportAs('new' + name);
    module.addFunction(undefined, makeSig([ref, kWasmI32], [element]))
        .addBody([kExprLocalGet, 0, kExprLocalGet, 1, kGCPrefix, kExprArrayGet, array])
        .exportAs('get' + name);
    module.addFunction(undefined, makeSig([ref, kWasmI32, element], []))
        .addBody([kExprLocalGet, 0, kExprLocalGet, 1, kExprLocalGet, 2,
                  kGCPrefix, kExprArraySet, array])
        .exportAs('set' + name);
  }
  return module.toBuffer();
}
const bytes = vm.runInContext('(' + buildSeriesModule.toString() + ')()', context);
console.log(Buffer.from(bytes).toString('base64'));
