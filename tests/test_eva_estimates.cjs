const test = require('node:test');
const assert = require('node:assert/strict');
global.window = { MARS_DATA: { layers: { grid: 1, dem: { min: 0, max: 1, b64: 'AA==' } } } };
require('../web/js/core.js');
const MR = window.MR;

test('default route duration uses walking instead of rover speed', () => {
  const points = [[137.4, -4.6, 0, 0, 0, 0, 1], [137.41, -4.6, 1, 0, 0, 0, 1]];
  assert.equal(MR.estimateHours(points), MR.estimateHours(points, 'astronaut'));
  assert.ok(MR.estimateHours(points) > MR.estimateHours(points, 'rover'));
  assert.equal(MR.routeResources(points).hours, MR.estimateHours(points, 'astronaut'));
});

test('resuming EVA requires available resources and daylight', () => {
  const state = { oxygen_pct: 50, battery_pct: 50, eva_time_min: 60, radiation_dose_msv: 0 };
  assert.equal(MR.evaResumeBlock(state, 12, 8, 17), null);
  assert.ok(MR.evaResumeBlock(state, 17, 8, 17));
  assert.ok(MR.evaResumeBlock({ ...state, oxygen_pct: 0 }, 12, 8, 17));
  assert.ok(MR.evaResumeBlock(null, 12, 8, 17));
  assert.ok(MR.evaResumeBlock({ ...state, battery_pct: NaN }, 12, 8, 17));
});

test('elapsed EVA time consumes resources across walking and rest without mutation', () => {
  const initial = { oxygen_pct: 100, battery_pct: 100, eva_time_min: 0, radiation_dose_msv: 0 };
  const walking = MR.consumeEvaResources(initial, 60, 0.2);
  const afterRest = MR.consumeEvaResources(walking, 60);
  assert.equal(initial.oxygen_pct, 100);
  assert.ok(Math.abs(afterRest.oxygen_pct - 71.25) < 1e-10);
  assert.equal(afterRest.battery_pct, 76);
  assert.equal(afterRest.eva_time_min, 120);
  assert.equal(afterRest.radiation_dose_msv, 0.05);
  assert.throws(() => MR.consumeEvaResources(initial, -1), RangeError);
  assert.throws(() => MR.consumeEvaResources({ ...initial, oxygen_pct: NaN }, 1), RangeError);
  assert.equal(MR.evaResourcesExhausted(afterRest), false);
  assert.equal(MR.evaResourcesExhausted(MR.consumeEvaResources(initial, 480)), true);
});

test('rest is rejected before advancing when it exhausts resources or reaches night', () => {
  const state = { oxygen_pct: 20, battery_pct: 20, eva_time_min: 100, radiation_dose_msv: 0 };
  assert.equal(MR.evaRestBlock(state, 14, 60, 8, 17), null);
  assert.ok(MR.evaRestBlock({ ...state, oxygen_pct: 10 }, 14, 60, 8, 17));
  assert.ok(MR.evaRestBlock({ ...state, eva_time_min: 450 }, 14, 60, 8, 17));
  assert.ok(MR.evaRestBlock(state, 16, 60, 8, 17));
  assert.equal(state.oxygen_pct, 20);
});
