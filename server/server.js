import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const TARGET = process.env.SUNDAI_FRAME_URL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://xandercogan.github.io';
const LEASE_MS = Number(process.env.LEASE_MS || 8000);
const WAITING_TTL_MS = Number(process.env.WAITING_TTL_MS || 15000);
const MAX_BODY = 64 * 1024;
const MAX_FRAMES_PER_SECOND = 20;

if (!TARGET) {
  console.error('SUNDAI_FRAME_URL is required');
  process.exit(1);
}

let active = null; // { clientId, token, expiresAt }
let queue = [];    // [{ clientId, joinedAt, lastSeen }]
let frameWindowStart = 0;
let frameWindowCount = 0;

function now() { return Date.now(); }
function validClientId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{12,128}$/.test(v); }
function newToken() { return crypto.randomBytes(32).toString('base64url'); }

function pruneQueue() {
  const cutoff = now() - WAITING_TTL_MS;
  const seen = new Set();
  queue = queue.filter((q) => {
    if (!q || !validClientId(q.clientId) || q.lastSeen < cutoff) return false;
    if (active && q.clientId === active.clientId) return false;
    if (seen.has(q.clientId)) return false;
    seen.add(q.clientId);
    return true;
  });
}

function promoteNext() {
  pruneQueue();
  if (active || queue.length === 0) return;
  const next = queue.shift();
  active = {
    clientId: next.clientId,
    token: newToken(),
    expiresAt: now() + LEASE_MS
  };
}

function refreshState() {
  if (active && active.expiresAt <= now()) active = null;
  pruneQueue();
  promoteNext();
}

function touchQueued(clientId) {
  const q = queue.find((x) => x.clientId === clientId);
  if (q) q.lastSeen = now();
}

function stateFor(clientId) {
  refreshState();
  if (active && active.clientId === clientId) {
    return {
      state: 'active',
      token: active.token,
      expiresAt: active.expiresAt,
      leaseMs: LEASE_MS,
      queueLength: queue.length,
      position: 0
    };
  }
  const idx = queue.findIndex((q) => q.clientId === clientId);
  if (idx >= 0) {
    return {
      state: 'queued',
      position: idx + 1,
      queueLength: queue.length,
      active: !!active
    };
  }
  return { state: 'none', position: null, queueLength: queue.length, active: !!active };
}

function join(clientId) {
  refreshState();
  if (active && active.clientId === clientId) return stateFor(clientId);
  const existing = queue.find((q) => q.clientId === clientId);
  if (existing) {
    existing.lastSeen = now();
    return stateFor(clientId);
  }
  queue.push({ clientId, joinedAt: now(), lastSeen: now() });
  promoteNext();
  return stateFor(clientId);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin'
    };
  }
  return {};
}

function sendJson(req, res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(obj));
}

function originAllowed(req) { return req.headers.origin === ALLOWED_ORIGIN; }

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('request too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function tokenFrom(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function isAuthorized(req) {
  refreshState();
  return !!(active && safeEqual(tokenFrom(req), active.token));
}

function validateFrame(v) {
  if (!Array.isArray(v) || v.length !== 17) return false;
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== 9) return false;
    for (const px of row) {
      if (!Array.isArray(px) || px.length !== 3) return false;
      for (const c of px) if (!Number.isInteger(c) || c < 0 || c > 255) return false;
    }
  }
  return true;
}

function frameRateAllowed() {
  const t = now();
  if (t - frameWindowStart >= 1000) {
    frameWindowStart = t;
    frameWindowCount = 0;
  }
  frameWindowCount += 1;
  return frameWindowCount <= MAX_FRAMES_PER_SECOND;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      if (!originAllowed(req)) return sendJson(req, res, 403, { error: 'origin denied' });
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      refreshState();
      return sendJson(req, res, 200, { ok: true, active: !!active, queueLength: queue.length });
    }

    if (!originAllowed(req)) return sendJson(req, res, 403, { error: 'origin denied' });

    if (url.pathname === '/api/join' && req.method === 'POST') {
      const body = await readJson(req);
      if (!validClientId(body.clientId)) return sendJson(req, res, 400, { error: 'invalid clientId' });
      return sendJson(req, res, 200, join(body.clientId));
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      const clientId = url.searchParams.get('clientId') || '';
      if (!validClientId(clientId)) return sendJson(req, res, 400, { error: 'invalid clientId' });
      touchQueued(clientId);
      return sendJson(req, res, 200, stateFor(clientId));
    }

    if (url.pathname === '/api/heartbeat' && req.method === 'POST') {
      if (!isAuthorized(req)) return sendJson(req, res, 401, { error: 'not controller' });
      active.expiresAt = now() + LEASE_MS;
      return sendJson(req, res, 200, stateFor(active.clientId));
    }

    if (url.pathname === '/api/release' && req.method === 'POST') {
      if (!isAuthorized(req)) return sendJson(req, res, 401, { error: 'not controller' });
      const oldId = active.clientId;
      active = null;
      promoteNext();
      return sendJson(req, res, 200, { ok: true, releasedClientId: oldId, queueLength: queue.length });
    }

    if (url.pathname === '/api/game-over' && req.method === 'POST') {
      if (!isAuthorized(req)) return sendJson(req, res, 401, { error: 'not controller' });
      refreshState();
      const oldClientId = active.clientId;
      pruneQueue();

      if (queue.length === 0) {
        active.expiresAt = now() + LEASE_MS;
        return sendJson(req, res, 200, {
          continued: true,
          ...stateFor(oldClientId)
        });
      }

      // Round-robin: the player who just finished goes to the back of the line.
      queue.push({ clientId: oldClientId, joinedAt: now(), lastSeen: now() });
      active = null;
      promoteNext();
      return sendJson(req, res, 200, {
        continued: false,
        ...stateFor(oldClientId)
      });
    }

    if (url.pathname === '/api/frame' && req.method === 'POST') {
      if (!isAuthorized(req)) return sendJson(req, res, 401, { error: 'not controller' });
      if (!frameRateAllowed()) return sendJson(req, res, 429, { error: 'frame rate limited' });
      const frame = await readJson(req);
      if (!validateFrame(frame)) return sendJson(req, res, 400, { error: 'invalid 17x9 RGB frame' });
      active.expiresAt = now() + LEASE_MS;
      const upstream = await fetch(TARGET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(frame)
      });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        return sendJson(req, res, 502, { error: `display upstream ${upstream.status}`, detail: text.slice(0, 200) });
      }
      return sendJson(req, res, 200, { ok: true });
    }

    return sendJson(req, res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return sendJson(req, res, 500, { error: 'server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`pong queue server listening on ${PORT}`);
});
