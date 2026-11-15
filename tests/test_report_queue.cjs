const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../web/js/api.js'), 'utf8');
function client(storage, fetch) {
  const window = { MR: {}, addEventListener() {} };
  vm.runInNewContext(source, { window, localStorage: storage, fetch, AbortController,
    setTimeout, clearTimeout, location: { protocol: 'http:' }, document: { getElementById() { return null; } } });
  return window.MR.API;
}
test('offline report survives reload and failed retry, then clears after acknowledgement', async () => {
  let data = '{}';
  const storage = { getItem: () => data, setItem: (_, value) => { data = value; } };
  let api = client(storage, async () => { throw Error('offline'); });
  const result = await api.sendReporte({ id: 'r1', text: 'Hallazgo' });
  assert.equal(result.persisted, true);
  api = client(storage, async () => { throw Error('offline'); });
  api.online = true;
  await api.flushReports();
  assert.ok(JSON.parse(data).r1);
  const received = [];
  api = client(storage, async (_, options) => {
    received.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true }) };
  });
  api.online = true;
  await Promise.all([api.flushReports(), api.flushReports()]);
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'r1');
  assert.deepEqual(JSON.parse(data), {});
});
test('storage failure is reported rather than claiming durable persistence', async () => {
  const api = client({ getItem: () => '{}', setItem: () => { throw Error('quota'); } }, async () => {});
  const result = await api.sendReporte({ id: 'r2' });
  assert.equal(result.persisted, false);
  assert.equal(result.ok, false);
});
