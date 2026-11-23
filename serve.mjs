// Tiny static server (no dependencies). Usage: node serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

// --- AI proxy: the API key lives only here (read from .env), never in browser code.
const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2];
  }
} catch { /* no .env: AI features fall back to offline lines */ }
const API_KEY = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || env.AI_MODEL || 'claude-fable-5-2';

function handleAI(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
  req.on('end', async () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    if (!API_KEY) return send(503, { error: 'no api key configured' });
    try {
      const b = JSON.parse(body || '{}');
      const payload = { model: b.model || AI_MODEL, max_tokens: Math.min(Math.max(b.max_tokens || 300, 700), 1500) /* floor leaves room for the thinking block */, messages: b.messages || [] };
      if (b.system) payload.system = b.system;
      if (b.tools) payload.tools = b.tools;
      if (b.tool_choice) payload.tool_choice = b.tool_choice;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
      });
      const text = await r.text();
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
    } catch (e) { send(500, { error: String(e && e.message || e) }); }
  });
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/ai')) return handleAI(req, res);
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const headers = { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? Number(m[1]) : 0, end = m[2] ? Number(m[2]) : st.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(port, '127.0.0.1', () => console.log(`TLV game on http://127.0.0.1:${port}/`));
