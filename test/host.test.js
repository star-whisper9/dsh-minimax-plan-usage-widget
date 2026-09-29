import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import plugin from '../src/host.js';

test('bundle uses the standard CN credential default without a deployment-specific override', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(patch, /credentialRef:/);
});

test('usage reuses saved CN credentials, the standard CN reference, or an explicit reference', async (t) => {
  for (const [name, record, config, expectedRef, expectedKey] of [
    ['saved CN key takes precedence', { kind: 'api-key', key: 'test-saved-key' }, { credentialRef: 'CUSTOM_PLAN_KEY' }, null, 'test-saved-key'],
    ['standard CN reference works without plugin configuration', undefined, {}, 'MINIMAX_CN_API_KEY', 'test-cn-key'],
    ['custom reference remains supported', undefined, { credentialRef: 'CUSTOM_PLAN_KEY' }, 'CUSTOM_PLAN_KEY', 'test-custom-key'],
  ]) {
    await t.test(name, async (t) => {
      let route, cleanup;
      const refs = [];
      const records = [];
      const requests = [];
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, authorization: options.headers.Authorization });
        return {
          ok: true,
          async json() {
            return {
              base_resp: { status_code: 0 },
              model_remains: [{ model_name: 'general', current_interval_remaining_percent: 80, current_weekly_remaining_percent: 90 }],
            };
          },
        };
      });
      plugin.apply({
        on() {},
        inject(names, callback) {
          callback({
            credentials: {
              async readRecord(key) { records.push(key); return record; },
              async resolve(ref) { refs.push(ref); return ref === expectedRef ? { value: expectedKey } : undefined; },
            },
            connection: { requestRejection: () => undefined },
            webServer: { register(value) { route = value; return () => {}; } },
            effect(callback) { cleanup = callback(); },
          });
        },
      }, config);
      t.after(() => cleanup());
      let body;
      await route.handler({ method: 'GET', url: '/minimax-plan-widget/usage', headers: {} }, {
        writeHead(status) { assert.equal(status, 200); },
        end(value) { body = JSON.parse(value); },
      });
      assert.equal(body.ok, true);
      assert.deepEqual(records, ['llm-pi-ai/minimax-cn']);
      assert.deepEqual(refs, expectedRef ? [expectedRef] : []);
      assert.deepEqual(requests, [{ url: 'https://www.minimax.cn/v1/token_plan/remains', authorization: `Bearer ${expectedKey}` }]);
      assert.equal(body.windows.fiveHour.usedPercent, 20);
    });
  }
});

test('routes require host authentication, whitelist resources and dispose cleanly', async () => {
  let route, cleanup, injection, removed = false, rejection = 401, credentialReads = 0;
  const ctx = {
    credentials: { async readRecord() { return undefined; }, async resolve() { credentialReads++; return undefined; } },
    connection: { requestRejection: () => rejection },
    webServer: { register(value) { route = value; return () => { removed = true; }; } },
    effect(callback) { cleanup = callback(); },
  };
  plugin.apply({ on(event, callback) { injection = callback; }, inject(names, callback) { callback(ctx); } });
  const rows = []; injection(rows);
  assert.match(rows[0].text, /import\('/);
  function response() {
    return Object.assign(new EventEmitter(), {
      status: 0, body: '', headersSent: false, headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; },
      write(chunk) { this.body += chunk; },
      end(chunk = '') { this.body += chunk; this.emit('close'); },
    });
  }
  const req = { method: 'GET', url: '/minimax-plan-widget/usage', headers: {} };
  let res = response(); await route.handler(req, res);
  assert.equal(res.status, 401); assert.equal(credentialReads, 0);
  rejection = undefined;
  res = response(); await route.handler({ ...req, method: 'POST' }, res); assert.equal(res.status, 405);
  res = response(); await route.handler({ ...req, headers: { 'sec-fetch-site': 'cross-site' } }, res); assert.equal(res.status, 403);
  res = response(); await route.handler({ ...req, url: '/minimax-plan-widget/LICENSE' }, res); assert.equal(res.status, 404);
  res = response(); await route.handler(req, res);
  assert.equal(JSON.parse(res.body).ok, false); assert.equal(credentialReads, 1);
  const audioReq = { ...req, url: '/minimax-plan-widget/assets/q-bounce.m4a' };
  for (const range of ['bytes=0-15', 'bytes=-16']) {
    res = response(); await route.handler({ ...audioReq, headers: { range } }, res);
    assert.equal(res.status, 206);
    assert.equal(res.headers['Content-Type'], 'audio/mp4');
    assert.equal(res.headers['Content-Length'], 16);
    assert.equal(res.headers['Accept-Ranges'], 'bytes');
  }
  res = response(); await route.handler({ ...audioReq, headers: { range: 'bytes=999999999-' } }, res);
  assert.equal(res.status, 416);
  res = response(); await route.handler({ ...req, url: '/minimax-plan-widget/events' }, res);
  assert.equal(res.status, 200);
  cleanup(); assert.equal(removed, true); assert.match(res.body, /event: dispose/);
});
