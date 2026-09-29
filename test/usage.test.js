import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, createUsageService, ENDPOINT } from '../src/usage.js';

const fixture = () => ({ base_resp: { status_code: 0 }, model_remains: [
  { model_name: 'video', current_interval_remaining_percent: 12 },
  { model_name: 'general', current_interval_remaining_percent: 100, current_weekly_remaining_percent: 99,
    end_time: 1790665200000, weekly_end_time: 1791129600000,
    current_interval_total_count: 0, current_interval_usage_count: 0 },
] });

test('reads general percentages, never video or zero token counts', () => {
  const value = parseUsage(fixture());
  assert.equal(value.fiveHour.usedPercent, 0);
  assert.equal(value.weekly.usedPercent, 1);
  assert.equal(Date.parse(value.weekly.resetAt), 1791129600000);
  const missing = fixture(); delete missing.model_remains[1].current_weekly_remaining_percent;
  assert.equal(parseUsage(missing).weekly, null);
  for (const bad of [null, {}, { base_resp: { status_code: 1004 } }]) assert.throws(() => parseUsage(bad));
  const invalid = fixture(); invalid.model_remains[1].current_interval_remaining_percent = 101;
  assert.throws(() => parseUsage(invalid), /百分比/);
});

test('coalesces requests, throttles manual refresh and visibly retains stale data on failure', async () => {
  let calls = 0, time = 0, fail = false;
  const service = createUsageService({ now: () => time, resolveKey: async () => 'test-secret', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, ENDPOINT);
    assert.equal(options.redirect, 'error');
    if (fail) throw new Error('test-secret must not leak');
    return { ok: true, json: async () => fixture() };
  } });
  const [a, b] = await Promise.all([service.get(), service.get(true)]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.equal(a.ok, true);
  await service.get(true); assert.equal(calls, 1);
  time = 11_000; fail = true;
  const stale = await service.get(true);
  assert.equal(stale.ok, false); assert.equal(stale.updatedAt, a.updatedAt);
  assert.equal(stale.windows.weekly.usedPercent, 1);
  assert.ok(!JSON.stringify(stale).includes('test-secret'));
  service.dispose();
  assert.equal((await service.get()).error, '插件已停止');
});
