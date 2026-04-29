// api/battle.js — Vercel Serverless Function
// Proxy ke JSONBin untuk fitur 1v1 Battle (API key aman di server)

const JSONBIN_API_KEY = '$2a$10$.YFrLFivKiL4oHkYlXXZ7OZu0yDi2xC.sLg0SNS0DRlWGeUmtxYpq';
const JSONBIN_BASE    = 'https://api.jsonbin.io/v3';

// ── CORS helper ──────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── JSONBin helpers ──────────────────────────────────────────────────
async function jbCreate(data) {
  const r = await fetch(`${JSONBIN_BASE}/b`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'X-Master-Key':  JSONBIN_API_KEY,
      'X-Bin-Private': 'false',
      'X-Bin-Name':    'battle-room-' + Date.now(),
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('jbCreate failed: ' + r.status + ' — ' + t);
  }
  const j = await r.json();
  return j.metadata.id;          // binId
}

async function jbRead(binId) {
  const r = await fetch(`${JSONBIN_BASE}/b/${binId}/latest`, {
    headers: { 'X-Master-Key': JSONBIN_API_KEY },
  });
  if (!r.ok) throw new Error('jbRead failed: ' + r.status);
  const j = await r.json();
  return j.record;               // raw state object
}

async function jbWrite(binId, data) {
  const r = await fetch(`${JSONBIN_BASE}/b/${binId}`, {
    method:  'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': JSONBIN_API_KEY,
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('jbWrite failed: ' + r.status + ' — ' + t);
  }
}

// ── Main handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);

  // Pre-flight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── GET — baca state room ─────────────────────────────────────────
  if (req.method === 'GET') {
    const { binId } = req.query;
    if (!binId) return res.status(400).json({ error: 'binId required' });

    try {
      const state = await jbRead(binId);
      return res.status(200).json({ success: true, state });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — berbagai action ────────────────────────────────────────
  if (req.method === 'POST') {
    let body = req.body;

    // Jika body masih string (edge runtime)
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid JSON' }); }
    }

    const { action, binId, data } = body || {};

    // ── create: Buat room baru ────────────────────────────────────
    if (action === 'create') {
      try {
        const newBinId = await jbCreate(data || {});
        return res.status(200).json({ success: true, binId: newBinId });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── joinRoom: Guest masuk room, tulis guestName ───────────────
    if (action === 'joinRoom') {
      if (!binId) return res.status(400).json({ error: 'binId required' });
      try {
        const state = await jbRead(binId);
        state.guestName = (data && data.guestName) ? data.guestName : 'Guest';
        state.phase     = 'waiting'; // masih tunggu host konfirmasi
        await jbWrite(binId, state);
        return res.status(200).json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── update: Tulis ulang seluruh state ────────────────────────
    if (action === 'update') {
      if (!binId) return res.status(400).json({ error: 'binId required' });
      try {
        await jbWrite(binId, data || {});
        return res.status(200).json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── sendMsg: Tulis pesan ke field host/guestMsg ───────────────
    // data = { role: 'host'|'guest', msg: { type, ...payload } }
    if (action === 'sendMsg') {
      if (!binId) return res.status(400).json({ error: 'binId required' });
      try {
        const state = await jbRead(binId);

        // Sequence number biar client tahu ada pesan baru
        const seq = ((state._seq || 0) + 1);
        state._seq = seq;

        const msgField = (data.role === 'host') ? 'hostMsg' : 'guestMsg';
        state[msgField] = { ...data.msg, seq };

        await jbWrite(binId, state);
        return res.status(200).json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
