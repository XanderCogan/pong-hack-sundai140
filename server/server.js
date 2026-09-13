import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const TARGET = process.env.SUNDAI_FRAME_URL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://xandercogan.github.io';
const LEASE_MS = Number(process.env.LEASE_MS || 10000);
const MAX_BODY = 64 * 1024;
const MAX_FRAMES_PER_SECOND = 20;

if (!TARGET) {
  console.error('SUNDAI_FRAME_URL is required');
  process.exit(1);
}

let lease = null;
let frameWindowStart = 0;
let frameWindowCount = 0;

function now() { return Date.now(); }
function currentLease() {
  if (lease && lease.expiresAt <= now()) lease = null;
  return lease;
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
function originAllowed(req) {
  return req.headers.origin === ALLOWED_ORIGIN;
}
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
function isAuthorized(req) {
  const l = currentLease();
  const token = tokenFrom(req);
  return !!(l && token && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(l.token)));
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
    if (req.method === 'OPTIONS') {
      if (!originAllowed(req)) return sendJson(req, res, 403, { error: 'origin denied' });
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    if (req.url === '/health' && req.method === 'GET') {
      return sendJson(req, res, 200, { ok: true });
    }

    if (!originAllowed(req)) return sendJson(req, res, 403, { error: 'origin denied' });

    if (req.url === '/api/status' && req.method === 'GET') {
      const l = currentLease();
      return sendJson(req, res, 200, {
        active: !!l,
        expiresAt: l?.expiresAt ?? null
      });
    }

    if (req.url === '/api/claim' && req.method === 'POST') {
      const existing = currentLease();
      if (existing) {
        return sendJson(req, res, 409, { granted: false, active: true, expiresAt: existing.expiresAt });
      }
      const token = crypto.randomBytes(32).toString('base64url');
      lease = { token, expiresAt: now() + LEASE_MS };
      return sendJson(req, res, 201, { granted: true, token, expiresAt: lease.expiresAt, leaseMs: LEASE_MS });
    }

    if (req.url === '/api/heartbeat' && req.method === 'POST') {
      if (!isAuthorized(req)) return sendJson(req, res, 401, { error: 'not controller' });
      lease.expiresAt = now() + LEASE_MS;
      return sendJson(req, res, 200, { ok: true, expiresAt: lease.expiresAt });
    }

    if (req.url === '/api/release' && req.method === 'POST') {
      if (!isAuthorized(req)) return sendJson(req, res, 401, { error: 'not controller' });
      lease = null;
      return sendJson(req, res, 200, { ok: true });
    }

    if (req.url === '/api/frame' && req.method === 'POST') {
      if (!isAuthorized(req)) return sendJson(req, res, 401, { error: 'not controller' });
      if (!frameRateAllowed()) return sendJson(req, res, 429, { error: 'frame rate limited' });
      const frame = await readJson(req);
      if (!validateFrame(frame)) return sendJson(req, res, 400, { error: 'invalid 17x9 RGB frame' });
      lease.expiresAt = now() + LEASE_MS;
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
  console.log(`controller lock listening on ${PORT}`);
});
