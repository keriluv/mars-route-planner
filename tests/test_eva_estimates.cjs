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
