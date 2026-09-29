import { readFile } from 'node:fs/promises';
import { createUsageService } from './usage.js';

const PREFIX = '/minimax-plan-widget';
const rootUrl = new URL('../', import.meta.url);
const files = new Map([
  ...['widget.js', 'template.js', 'geometry.js'].map(name => [name, [`src/${name}`, 'text/javascript; charset=utf-8']]),
  ['widget.css', ['src/widget.css', 'text/css; charset=utf-8']],
  ...['dsh-minimax-chibi', 'dsh-minimax-chibi-blank', 'dsh-minimax-chibi-grin'].map(name => [`assets/${name}.optimized.png`, [`assets/${name}.optimized.png`, 'image/png']]),
]);
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function json(res, status, body) { res.writeHead(status, jsonHeaders); res.end(JSON.stringify(body)); }

export default {
  name: 'minimax-plan-usage-widget',
  apply(root, config = {}) {
    const credentialRef = config.credentialRef ?? 'MINIMAX_CN_API_KEY';
    if (typeof credentialRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialRef)) {
      throw new TypeError('credentialRef must be a credential reference name, never a key value');
    }
    // Register before service availability, so startup injection collection cannot miss it.
    root.on('webserver/index-inject', table => {
      table.push({ kind: 'script', placement: 'body', text:
        `import('${PREFIX}/widget.js').catch(error => console.error('[MiniMax Plan Widget] 加载失败', error));` });
    });
    root.inject(['webServer', 'credentials', 'connection'], ctx => {
      if (typeof ctx.connection.requestRejection !== 'function') {
        throw new Error('MiniMax Plan Widget requires DSH connection.requestRejection (tested on 0.1.7-rc.2)');
      }
      const usage = createUsageService({ resolveKey: async () => {
        const record = await ctx.credentials.readRecord('llm-pi-ai/minimax-cn');
        if (record?.kind === 'api-key' && record.key) return record.key;
        return (await ctx.credentials.resolve(credentialRef))?.value;
      } });
      const clients = new Set();
      const disposeRoute = ctx.webServer.register({
        kind: 'prefix', path: PREFIX,
        async handler(req, res) {
          // Fail closed and delegate trust/authentication to the host, including local browser cookies.
          let rejection;
          try { rejection = ctx.connection.requestRejection(req); }
          catch { json(res, 403, { error: '宿主认证检查失败' }); return; }
          if (rejection) { json(res, rejection, { error: '请先登录 DSH Web' }); return; }
          if (req.headers['sec-fetch-site'] === 'cross-site') { json(res, 403, { error: '禁止跨站访问' }); return; }
          if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json(res, 405, { error: '仅支持 GET' }); return; }
          try {
            const url = new URL(req.url, 'http://localhost');
            const name = url.pathname.slice(PREFIX.length + 1);
            if (name === 'usage') {
              json(res, 200, await usage.get(url.searchParams.get('refresh') === '1'));
              return;
            }
            if (name === 'events') {
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
              res.write(': connected\n\n');
              clients.add(res);
              const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
              res.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
              return;
            }
            const file = files.get(name);
            if (!file) { json(res, 404, { error: '资源不存在' }); return; }
            const bytes = await readFile(new URL(file[0], rootUrl));
            res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Length': bytes.length });
            res.end(bytes);
          } catch (error) {
            console.error('[MiniMax Plan Widget] local route failed:', error?.code || error?.name || 'Error');
            if (!res.headersSent) json(res, 500, { error: '挂件服务异常，请检查 DSH 日志' });
            else res.end();
          }
        },
      });
      ctx.effect(() => () => {
        usage.dispose();
        for (const client of clients) client.end('event: dispose\ndata: {}\n\n');
        clients.clear();
        disposeRoute();
      });
    });
  },
};
