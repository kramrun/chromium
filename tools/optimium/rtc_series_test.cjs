// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

async function run() {
  const filename = '../../content/browser/webrtc/resources/data_series.js';
  const source = fs.readFileSync(path.resolve(__dirname, filename), 'utf8');
  const encoded = execFileSync(process.execPath,
      [path.join(__dirname, 'generate_rtc_series_wasm.cjs')], {encoding: 'utf8'}).trim();
  assert.ok(source.includes(encoded));
  const {TimelineDataSeries} = await import('data:text/javascript;base64,' +
      Buffer.from(source).toString('base64'));
  const limit = 1000;
  const epoch = 1700000000000;
  function compare(series, expected) {
    assert.equal(series.getCount(), expected.length);
    const dump = series.toJSON();
    if (!expected.length) {
      assert.deepEqual(dump, {});
      return;
    }
    assert.deepEqual(dump, {
      startTime: expected[0].time,
      endTime: expected.at(-1).time,
      statsType: 'transport',
      values: JSON.stringify(expected.map(p => p.value)),
    });
    for (let i = 0; i < expected.length; i++) {
      assert.ok(Object.is(series.valueAt_(i), expected[i].value));
    }
    const start = epoch - 100;
    let j = 0;
    let previous = 0;
    const graph = [];
    for (let i = 0; i < 150; i++) {
      let sum = null;
      let count = 0;
      while (j < expected.length && expected[j].time < start + 83 * i) {
        sum += expected[j++].value;
        ++count;
      }
      previous = count ? sum / count : previous;
      graph.push(previous);
    }
    assert.deepEqual(series.getValues(start, 83, graph.length), graph);
  }
  const cases = [
    i => [epoch + i, 0],
    i => [epoch + i, i < 1050 ? -0 : +0],
    i => [epoch + i * 3.7, i % 21 - 0.5],
    i => [epoch + i, i < 1800 ? i : -0],
    i => [epoch + i, i < 420 ? i : 2 ** 32 + i],
    i => [epoch + i, i < 256 ? i : i + 0.25],
    i => [epoch + (i >> 2), i % 2 ? Infinity : NaN],
    i => [epoch + i, i === 1200 ? 'state' : i],
    i => [i === 1100 ? new Date(NaN) : epoch + i, i],
    i => [i < 1100 ? epoch - i : epoch + 2 ** 31 + i, i],
    i => [new Date(epoch + i).toISOString(), i % 3 ? true : null],
  ];
  for (const pair of cases) {
    const series = new TimelineDataSeries('transport');
    const expected = [];
    compare(series, expected);
    for (let i = 0; i < 2100; ++i) {
      const [time, value] = pair(i);
      series.addPoint(time, value);
      expected.push({time: new Date(time), value});
      if (expected.length > limit) expected.shift();
      if ([0, 254, 255, 256, 999, 1000, 1100, 1200, 2099].includes(i)) {
        compare(series, expected);
      }
    }
  }
  const series = new TimelineDataSeries('transport');
  for (let i = 0; i < 1001; ++i) series.addPoint(epoch + i, 17);
  assert.equal(Boolean(series.offsets_), typeof WebAssembly !== 'undefined');
  assert.equal(series.numbers_, null);
  series.addPoint(epoch + 1001, 18);
  assert.equal(Boolean(series.numbers_), typeof WebAssembly !== 'undefined');
  console.log('Passed differential checks on 11 sequences, wraparound and constant storage.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
