const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const UUID = (process.env.VLESS_UUID || 'd51cad89-5064-4db9-a49e-e09de5254673').trim().toLowerCase();
const UUID_BYTES = parseUUID(UUID);
const MAX_HEADER = 8192;
const CONNECT_TIMEOUT = 10000;
const ALLOWED_PORTS = new Set([80, 443]);
const WS_HIGH_WATER = 8 * 1024 * 1024;
const WS_LOW_WATER = 2 * 1024 * 1024;

function parseUUID(s) {
  const h = s.replace(/-/g, '');
  return /^[0-9a-f]{32}$/i.test(h) ? Buffer.from(h, 'hex') : null;
}
function same(a, b) {
  return a && b && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function blocked(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h === 'localhost.localdomain' || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return h === '::1' || h === '0.0.0.0';
}
function parseHeader(buf) {
  if (buf.length < 18) return { needMore: true };
  if (buf[0] !== 0) return { error: 'invalid_version' };
  if (!UUID_BYTES || !same(buf.subarray(1, 17), UUID_BYTES)) return { error: 'invalid_uuid' };
  const addonLen = buf[17];
  let p = 18;
  if (buf.length < p + addonLen + 4) return { needMore: true };
  p += addonLen;
  const cmd = buf[p++];
  if (cmd !== 1) return { error: 'only_tcp_supported' };
  const port = buf.readUInt16BE(p); p += 2;
  const atyp = buf[p++];
  let host;
  if (atyp === 1) {
    if (buf.length < p + 4) return { needMore: true };
    host = `${buf[p]}.${buf[p + 1]}.${buf[p + 2]}.${buf[p + 3]}`;
    p += 4;
  } else if (atyp === 2) {
    if (buf.length < p + 1) return { needMore: true };
    const len = buf[p++];
    if (buf.length < p + len) return { needMore: true };
    host = buf.subarray(p, p + len).toString();
    p += len;
  } else if (atyp === 3) {
    if (buf.length < p + 16) return { needMore: true };
    const q = [];
    for (let i = 0; i < 8; i++) q.push(buf.readUInt16BE(p + i * 2).toString(16));
    host = q.join(':');
    p += 16;
  } else {
    return { error: 'invalid_address_type' };
  }
  if (!host || host.length > 255) return { error: 'invalid_destination' };
  if (!ALLOWED_PORTS.has(port)) return { error: 'destination_port_not_allowed' };
  if (blocked(host)) return { error: 'destination_blocked' };
  return { host, port, headerLength: p, body: buf.subarray(p) };
}
async function resolve4first(host) {
  const list = await dns.lookup(host, { all: true, verbatim: false });
  return list.sort((a, b) => (a.family === 4 ? -1 : b.family === 4 ? 1 : 0));
}
function responseHeader(v) {
  return Buffer.from([v, 0]);
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'vless-ws-v4.6', endpoint: '/api/ws' }));
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

const wss = new WebSocketServer({
  server,
  path: '/api/ws',
  maxPayload: 8 * 1024 * 1024,
  perMessageDeflate: false,
});

wss.on('connection', (ws) => {
  let socket = null;
  let parsed = null;
  let headerBuf = Buffer.alloc(0);
  let closed = false;
  let connecting = false;
  let connected = false;
  let connectGeneration = 0;
  let pendingUpstream = [];
  let pendingBytes = 0;
  let drainTimer = null;

  const fail = (reason) => {
    if (closed) return;
    closed = true;
    if (drainTimer) clearInterval(drainTimer);
    pendingUpstream = [];
    pendingBytes = 0;
    try { ws.close(1011, String(reason).slice(0, 120)); } catch {}
    if (socket) socket.destroy();
  };

  const flushPending = () => {
    if (closed || !socket || socket.destroyed || !connected) return;
    while (pendingUpstream.length) {
      const chunk = pendingUpstream.shift();
      pendingBytes -= chunk.length;
      if (!socket.write(chunk)) {
        pendingUpstream.unshift(chunk);
        pendingBytes += chunk.length;
        return;
      }
    }
  };

  const startConnect = async (info) => {
    if (connecting || closed) return;
    connecting = true;
    const generation = ++connectGeneration;
    let addrs;
    try {
      addrs = await resolve4first(info.host);
    } catch {
      return fail('dns_failed');
    }
    if (closed || generation !== connectGeneration) return;

    let index = 0;
    const tryNext = () => {
      if (closed || generation !== connectGeneration) return;
      if (index >= addrs.length) return fail('upstream_connect_failed');
      const addr = addrs[index++];
      let attemptDone = false;
      const s = net.createConnection({ host: addr.address, port: info.port, family: addr.family });
      socket = s;
      s.setNoDelay(true);
      s.setKeepAlive(true, 15000);
      s.setTimeout(CONNECT_TIMEOUT);

      const finishAttempt = (ok) => {
        if (attemptDone) return false;
        attemptDone = true;
        return ok;
      };

      const timer = setTimeout(() => {
        if (!finishAttempt(false)) return;
        try { s.destroy(); } catch {}
        tryNext();
      }, CONNECT_TIMEOUT);

      s.once('connect', () => {
        if (!finishAttempt(true) || closed) return;
        clearTimeout(timer);
        s.setTimeout(0);
        connected = true;
        connecting = false;
        try {
          if (ws.readyState === ws.OPEN) ws.send(responseHeader(0));
        } catch {
          return fail('response_header_failed');
        }
        flushPending();
      });

      s.on('data', (chunk) => {
        if (closed || ws.readyState !== ws.OPEN) return;
        try {
          ws.send(chunk, { binary: true });
          if (ws.bufferedAmount > WS_HIGH_WATER && !drainTimer) {
            s.pause();
            drainTimer = setInterval(() => {
              if (closed || s.destroyed) {
                clearInterval(drainTimer);
                drainTimer = null;
                return;
              }
              if (ws.bufferedAmount <= WS_LOW_WATER) {
                clearInterval(drainTimer);
                drainTimer = null;
                s.resume();
              }
            }, 25);
          }
        } catch {
          fail('ws_send_failed');
        }
      });

      s.on('timeout', () => {
        if (!connected) {
          if (finishAttempt(false)) {
            clearTimeout(timer);
            s.destroy();
            tryNext();
          }
        } else {
          fail('upstream_timeout');
        }
      });

      s.on('error', () => {
        if (!connected) {
          if (finishAttempt(false)) {
            clearTimeout(timer);
            tryNext();
          }
        } else {
          fail('upstream_error');
        }
      });

      s.on('close', () => {
        clearTimeout(timer);
        if (!connected && !closed && !attemptDone) {
          finishAttempt(false);
          tryNext();
        } else if (connected && !closed) {
          closed = true;
          try { ws.close(1000); } catch {}
        }
      });
    };
    tryNext();
  };

  ws.on('message', (data) => {
    if (closed) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (!parsed) {
      headerBuf = Buffer.concat([headerBuf, chunk]);
      if (headerBuf.length > MAX_HEADER) return fail('header_too_large');
      const r = parseHeader(headerBuf);
      if (r.needMore) return;
      if (r.error) return fail(r.error);
      parsed = r;
      headerBuf = Buffer.alloc(0);
      if (r.body.length) {
        pendingUpstream.push(r.body);
        pendingBytes += r.body.length;
      }
      return startConnect(r);
    }

    // Never drop frames while the TCP connection is still being established.
    if (pendingBytes + chunk.length > WS_HIGH_WATER) return fail('upstream_pending_overflow');
    pendingUpstream.push(chunk);
    pendingBytes += chunk.length;
    flushPending();
  });

  ws.on('close', () => {
    closed = true;
    if (drainTimer) clearInterval(drainTimer);
    if (socket) socket.destroy();
  });
  ws.on('error', () => {
    closed = true;
    if (drainTimer) clearInterval(drainTimer);
    if (socket) socket.destroy();
  });
});

module.exports = server;
