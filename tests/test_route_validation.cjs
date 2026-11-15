const test = require('node:test');
const assert = require('node:assert/strict');
global.window = { MR: {} };
require('../web/js/route-validation.js');
const approval = window.MR.routeApproval;
const points = [[137.4, -4.6, 0, 0, 0, 0, 1], [137.41, -4.61, 0.7141234, 0, 0, 0, 1]];
const valid = { is_valid: true, stop_adjustments: [{ distance_m: 1 }, { distance_m: 2 }], alternative: { is_valid: true, points, resources: { oxygen_pct: 80 } } };
test('a rejected or incomplete result cannot approve a route', () => {
  assert.equal(approval.create({ ...valid, is_valid: false }, 'gale', 'segura'), null);
  assert.equal(approval.create({ is_valid: true }, 'gale', 'segura'), null);
  assert.equal(approval.create({ ...valid, stop_adjustments: [] }, 'gale', 'segura'), null);
  assert.equal(approval.create({ ...valid, alternative: { ...valid.alternative, points: [points[0], [0, 0, -1, 0, 0, 0, 1]] } }, 'gale', 'segura'), null);
});
test('accepted route retains the server distance and is independently copied', () => {
  const a = approval.create(valid, 'gale', 'segura');
  const route = approval.copyPoints(a);
  assert.deepEqual(route, points);
  assert.notEqual(route[1], points[1]);
  assert.equal(route[1][2], 0.7141234);
});
test('approval does not transfer to a different route, region or profile', () => {
  const a = approval.create(valid, 'gale', 'segura');
  assert.ok(approval.matches(a, points, 'gale', 'segura'));
  assert.equal(approval.matches(a, points.slice(), 'gale', 'segura'), false);
  assert.equal(approval.matches(a, points, 'jezero', 'segura'), false);
  assert.equal(approval.matches(a, points, 'gale', 'rapida'), false);
});
test('createLocal generates valid approval conforming to route verification', () => {
  const a = approval.createLocal(points, 'gale', 'segura');
  assert.ok(a);
  assert.ok(approval.matches(a, points, 'gale', 'segura'));
  assert.equal(a.resources.oxygen_pct, 100);
  assert.equal(approval.createLocal([[1, 2]], 'gale', 'segura'), null);
});
