'use strict';
// Yerel ajan kanalı: sadece 127.0.0.1'de, rastgele portta dinleyen HTTP uç noktası.
// MCP köprüsü (src/mcp/bridge.js) araç çağrılarını buraya iletir. Her istek agent.json'daki
// rastgele anahtarı taşımalıdır (tarayıcıdaki sayfalar anahtarı bilemez). Ağa açılmaz.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');

const MAX_BODY = 20 * 1024 * 1024;

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('istek çok büyük')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Kanalı başlat. run(name, args) -> sonuç (hata fırlatırsa ajan hata metnini görür).
 * agent.json'a {port, token, pid} yazılır; stop() kanalı kapatır ve dosyayı siler.
 */
async function startAgentServer({ file, run }) {
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const reply = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'POST' || req.url !== '/tool') return reply(404, { error: 'yok' });
    if (!sameToken(req.headers['x-fuxaw-token'], token)) return reply(403, { error: 'izin yok' });
    let msg;
    try {
      msg = JSON.parse(await readBody(req));
    } catch (e) {
      return reply(400, { error: `geçersiz istek: ${e.message}` });
    }
    try {
      reply(200, { result: await run(String(msg.name || ''), msg.args || {}) });
    } catch (e) {
      reply(200, { error: e.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  fs.writeFileSync(file, JSON.stringify({ port, token, pid: process.pid }, null, 2), { encoding: 'utf8', mode: 0o600 });
  return {
    port,
    stop() {
      server.close();
      try {
        const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (cur.token === token) fs.rmSync(file, { force: true });
      } catch { /* zaten yok */ }
    },
  };
}

module.exports = { startAgentServer };
