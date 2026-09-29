import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import plugin from '../src/host.js';

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
      status: 0, body: '', headersSent: false,
      setHeader() {},
      writeHead(status) { this.status = status; this.headersSent = true; },
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
  res = response(); await route.handler({ ...req, url: '/minimax-plan-widget/events' }, res);
  assert.equal(res.status, 200);
  cleanup(); assert.equal(removed, true); assert.match(res.body, /event: dispose/);
});
