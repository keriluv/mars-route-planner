const test = require('node:test');
const assert = require('node:assert/strict');
global.window = { MR: {} };
require('../web/js/route-validation.js');
const approval = window.MR.routeApproval;
const points = [[137.4, -4.6], [137.41, -4.61]];
const valid = { is_valid: true, stop_adjustments: [{ distance_m: 1 }, { distance_m: 2 }], alternative: { is_valid: true, points, resources: { oxygen_pct: 80 } } };
test('a rejected or incomplete result cannot approve a route', () => {
  assert.equal(approval.create({ ...valid, is_valid: false }, 'gale', 'segura'), null);
  assert.equal(approval.create({ is_valid: true }, 'gale', 'segura'), null);
  assert.equal(approval.create({ ...valid, stop_adjustments: [] }, 'gale', 'segura'), null);
});
test('approval does not transfer to a different route, region or profile', () => {
  const a = approval.create(valid, 'gale', 'segura');
  assert.ok(approval.matches(a, points, 'gale', 'segura'));
  assert.equal(approval.matches(a, points.slice(), 'gale', 'segura'), false);
  assert.equal(approval.matches(a, points, 'jezero', 'segura'), false);
  assert.equal(approval.matches(a, points, 'gale', 'rapida'), false);
});
