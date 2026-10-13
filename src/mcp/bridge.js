#!/usr/bin/env node
'use strict';
// fuxaw yerel ajan köprüsü: MCP sunucusu (stdio, satır başına bir JSON-RPC 2.0 mesajı).
// AI ajanı (ör. Claude Code) bu betiği başlatır; araç çağrıları çalışan fuxaw uygulamasının
// sadece 127.0.0.1'de dinleyen kanalına iletilir. Kanalın portu ve anahtarı uygulamanın
// yazdığı agent.json dosyasındadır (--agent-file <yol>).
//
// Bağımlılıksız; paketlenmiş halde uygulamayla gelen Node ile çalışır. stdout sadece
// protokol içindir, günlük stderr'e yazılır.

const fs = require('node:fs');
const readline = require('node:readline');
const { INSTRUCTIONS, TOOLS } = require('./tools');

const VERSION = '1';
const DEFAULT_PROTOCOL = '2025-06-18';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

const AGENT_FILE = argValue('--agent-file') || process.env.FUXAW_AGENT_FILE;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function log(...a) {
  process.stderr.write(`[fuxaw-mcp] ${a.join(' ')}\n`);
}

class AppError extends Error {}

function readAgentFile() {
  if (!AGENT_FILE) throw new AppError('Köprü --agent-file olmadan başlatıldı. fuxaw → Ayarlar → AI ajan kurulumu… komutunu kullan.');
  let info;
  try {
    info = JSON.parse(fs.readFileSync(AGENT_FILE, 'utf8'));
  } catch {
    throw new AppError('fuxaw açık değil ya da ajan bağlantısı kapalı (Ayarlar → AI ajan bağlantısı). Uygulamayı açıp tekrar dene.');
  }
  if (!info || !info.port || !info.token) throw new AppError(`${AGENT_FILE} geçersiz.`);
  // Uygulama çökmüş/zorla kapatılmışsa dosya geride kalır.
  if (info.pid) {
    try { process.kill(info.pid, 0); } catch (e) {
      if (e.code === 'ESRCH') throw new AppError('fuxaw açık değil. Uygulamayı açıp tekrar dene.');
    }
  }
  return info;
}

async function callApp(name, args) {
  const info = readAgentFile();
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${info.port}/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fuxaw-Token': info.token },
      body: JSON.stringify({ name, args: args || {} }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    throw new AppError(`fuxaw uygulamasına ulaşılamadı (${e.message}). Uygulama açık mı?`);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) throw new AppError(body.error || `HTTP ${r.status}`);
  return body.result;
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: (params && params.protocolVersion) || DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'fuxaw', version: VERSION },
          instructions: INSTRUCTIONS,
        };
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const name = params && params.name;
        if (!TOOLS.some((t) => t.name === name)) {
          if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Bilinmeyen araç: ${name}` } });
          return;
        }
        try {
          const out = await callApp(name, params.arguments);
          result = { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] };
        } catch (e) {
          // Araç hatası: ajan okuyup düzeltebilsin diye sonuç olarak döner.
          result = { content: [{ type: 'text', text: e.message }], isError: true };
        }
        break;
      }
      default:
        if (!isRequest) return; // bildirimler (notifications/initialized vb.)
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Desteklenmeyen yöntem: ${method}` } });
        return;
    }
    if (isRequest) send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    log('hata:', e.stack || e.message);
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Geçersiz JSON' } });
      return;
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
  });
  rl.on('close', () => process.exit(0));
}

module.exports = { handle };
