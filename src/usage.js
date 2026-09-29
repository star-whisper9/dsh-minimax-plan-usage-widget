// MiniMax Token Plan contract: general is the text pool; video is separate.
export const ENDPOINT = 'https://www.minimax.cn/v1/token_plan/remains';

export class QuotaError extends Error {}

function windowOf(row, prefix, endKey) {
  const remaining = row[`${prefix}_remaining_percent`];
  if (remaining == null) return null;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) {
    throw new QuotaError('MiniMax 返回了无效的剩余百分比');
  }
  const end = row[endKey];
  if (end != null && (typeof end !== 'number' || !Number.isFinite(end) || end <= 0 || end > 8640000000000000)) {
    throw new QuotaError('MiniMax 返回了无效的重置时间');
  }
  return {
    usedPercent: Math.round((100 - remaining) * 100) / 100,
    resetAt: end == null ? null : new Date(end).toISOString(),
  };
}

export function parseUsage(data) {
  if (data?.base_resp?.status_code !== 0) {
    const code = data?.base_resp?.status_code;
    throw new QuotaError(`MiniMax 查询失败${typeof code === 'number' ? `（状态码 ${code}）` : '（响应缺少状态码）'}`);
  }
  const rows = data.model_remains;
  const general = Array.isArray(rows) ? rows.filter(row => row?.model_name === 'general') : [];
  if (general.length !== 1) throw new QuotaError('MiniMax 响应缺少唯一的 general 文本套餐');
  const fiveHour = windowOf(general[0], 'current_interval', 'end_time');
  const weekly = windowOf(general[0], 'current_weekly', 'weekly_end_time');
  if (!fiveHour && !weekly) throw new QuotaError('MiniMax 未提供 5h 或周用量百分比');
  return { fiveHour, weekly };
}

// One cache per plugin instance, shared across tabs. Never store API keys or raw responses.
export function createUsageService({ resolveKey, fetchImpl = fetch, now = Date.now }) {
  let snapshot = { updatedAt: null, windows: { fiveHour: null, weekly: null } };
  let state = { ok: false, ...snapshot, error: '尚未查询' };
  let lastAttempt = -Infinity;
  let pending;
  let controller;
  let disposed = false;

  async function query() {
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const key = await resolveKey();
      if (!key) throw new QuotaError('未配置国内 Token Plan 密钥，请在 DSH 的 MiniMax CN 模型设置中保存，或检查插件 credentialRef');
      if (disposed) throw new QuotaError('插件已停止');
      const response = await fetchImpl(ENDPOINT, {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) throw new QuotaError(`MiniMax 查询失败（HTTP ${response.status}）`);
      let data;
      try { data = await response.json(); } catch { throw new QuotaError('MiniMax 返回了非 JSON 响应'); }
      const windows = parseUsage(data);
      snapshot = { windows, updatedAt: new Date(now()).toISOString() };
      state = { ok: true, ...snapshot, error: null };
    } catch (error) {
      // Do not return upstream response text or credential-provider errors: either can contain secrets.
      state = { ok: false, ...snapshot, error: error instanceof QuotaError ? error.message : '查询超时或连接失败，请检查网络及 MiniMax 服务' };
    } finally {
      clearTimeout(timeout);
      controller = undefined;
    }
    return state;
  }

  return {
    get(refresh = false) {
      if (disposed) return Promise.resolve({ ...state, ok: false, error: '插件已停止' });
      if (pending) return pending;
      // Manual requests are rate-limited too, including failed attempts.
      const ttl = refresh ? 10_000 : 60_000;
      if (now() - lastAttempt < ttl) return Promise.resolve(state);
      lastAttempt = now();
      pending = query().finally(() => { pending = undefined; });
      return pending;
    },
    dispose() { disposed = true; controller?.abort(); },
  };
}
