const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const apiSource = fs.readFileSync(path.join(__dirname, '../web/js/api.js'), 'utf8');

function createApiClient(fetchMock) {
  const window = {
    MR: {},
    addEventListener() {},
    setInterval() {},
    clearInterval() {}
  };
  vm.runInNewContext(apiSource, {
    window,
    localStorage: { getItem() { return '{}'; }, setItem() {} },
    fetch: fetchMock,
    AbortController,
    setTimeout,
    clearTimeout,
    location: { protocol: 'http:' },
    document: { getElementById() { return null; } }
  });
  return window.MR.API;
}

test('API.route includes initial_resources in payload when provided', async () => {
  let sentBody = null;
  const mockFetch = async (url, opts) => {
    if (url.includes('route')) {
      sentBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          is_valid: true,
          stop_adjustments: [{ distance_m: 0 }, { distance_m: 0 }],
          alternative: {
            is_valid: true,
            total_km: 2.5,
            estimated_hours: 1.2,
            points: [
              [137.4, -4.6, 0, 0, 0, 0, 1],
              [137.41, -4.61, 2.5, 10, 2, 0.1, 0.9]
            ],
            resources: {
              oxygen_pct: 65.5,
              battery_pct: 70.0,
              eva_time_min: 150.0,
              radiation_dose_msv: 0.08
            }
          }
        })
      };
    }
    return { ok: false };
  };

  const API = createApiClient(mockFetch);
  API.online = true;

  const stops = [[137.4, -4.6], [137.41, -4.61]];
  const initial = {
    oxygen_pct: 85.0,
    battery_pct: 80.0,
    eva_time_min: 60.0,
    radiation_dose_msv: 0.03
  };

  const res = await API.route(stops, {}, 'segura', 'gale', initial);
  assert.ok(res);
  assert.ok(res.is_valid);
  assert.ok(sentBody);
  assert.deepEqual(sentBody.initial_resources, initial);
  assert.equal(sentBody.profile, 'segura');
  assert.equal(sentBody.region, 'gale');
});

test('API.route omits initial_resources when not provided', async () => {
  let sentBody = null;
  const mockFetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ is_valid: true })
    };
  };

  const API = createApiClient(mockFetch);
  API.online = true;

  const stops = [[137.4, -4.6], [137.41, -4.61]];
  await API.route(stops, {}, 'rapida', 'gale');
  assert.ok(sentBody);
  assert.equal(sentBody.initial_resources, undefined);
});

