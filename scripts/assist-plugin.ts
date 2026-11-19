// Mounts the assistant proxy (worker/assist.ts) on the local dev and preview servers:
// GET /api/assist/health and POST /api/assist. The API key comes from ANTHROPIC_API_KEY in .env
// (read here, server side only; never exposed to the browser bundle). The GitHub Pages build has no
// server, so the app's health check fails there and the assistant stays hidden.
import type { Connect, Plugin } from 'vite';
import { loadEnv } from 'vite';
import { assist, health } from '../worker/assist';

const MAX_BODY = 64 * 1024;

export function assistProxy(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  const key = env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || undefined;

  const send = (res: Parameters<Connect.NextHandleFunction>[1], status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0]!;
    if (!path.endsWith('/api/assist') && !path.endsWith('/api/assist/health')) return next();
    if (path.endsWith('/health')) return send(res, 200, health(key).body);
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, { error: 'bad-json' });
      }
      void assist(body, key).then((r) => send(res, r.status, r.body));
    });
  };

  return {
    name: 'groovebox-assist',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
