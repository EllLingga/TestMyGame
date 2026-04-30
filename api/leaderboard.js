// api/leaderboard.js — Vercel Serverless Function
// Leaderboard global: simpan & ambil data deck + profil player

const JSONBIN_API_KEY = '$2a$10$.YFrLFivKiL4oHkYlXXZ7OZu0yDi2xC.sLg0SNS0DRlWGeUmtxYpq';
const JSONBIN_BASE    = 'https://api.jsonbin.io/v3';
const BIN_NAME        = 'anime-gacha-leaderboard-v1';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function getOrCreateBin() {
  // Coba baca dari env dulu
  if (process.env.LEADERBOARD_BIN_ID) return process.env.LEADERBOARD_BIN_ID;

  // Cari bin yang sudah ada berdasarkan nama
  try {
    const searchRes = await fetch(`${JSONBIN_BASE}/b?name=${BIN_NAME}`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    if (searchRes.ok) {
      const bins = await searchRes.json();
      if (Array.isArray(bins) && bins.length > 0) return bins[0].id;
    }
  } catch(_) {}

  // Buat bin baru
  const createRes = await fetch(`${JSONBIN_BASE}/b`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': JSONBIN_API_KEY,
      'X-Bin-Name': BIN_NAME,
      'X-Bin-Private': 'false',
    },
    body: JSON.stringify({ players: [] }),
  });
  const data = await createRes.json();
  console.log('LEADERBOARD_BIN_ID:', data.metadata?.id, '— Set ini sebagai env variable!');
  return data.metadata?.id;
}

async function readBin(binId) {
  const res = await fetch(`${JSONBIN_BASE}/b/${binId}/latest`, {
    headers: { 'X-Master-Key': JSONBIN_API_KEY }
  });
  const data = await res.json();
  return data.record || { players: [] };
}

async function writeBin(binId, record) {
  await fetch(`${JSONBIN_BASE}/b/${binId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': JSONBIN_API_KEY,
    },
    body: JSON.stringify(record),
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const binId = await getOrCreateBin();

    // GET — ambil top leaderboard
    if (req.method === 'GET') {
      const record = await readBin(binId);
      const players = (record.players || [])
        .sort((a, b) => b.deckPower - a.deckPower)
        .slice(0, 100); // Top 100
      return res.status(200).json({ success: true, players });
    }

    // POST — update profil + deck player
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
      }

      const { playerName, deckPower, showcaseDeck, avatar, stats } = body || {};
      if (!playerName) return res.status(400).json({ error: 'playerName required' });

      const record = await readBin(binId);
      if (!record.players) record.players = [];

      // Cari atau buat entry player
      let idx = record.players.findIndex(p =>
        p.playerName && p.playerName.toLowerCase() === playerName.toLowerCase()
      );

      const playerData = {
        playerName,
        deckPower: Number(deckPower) || 0,
        showcaseDeck: showcaseDeck || [],  // Array of max 3 cards: [{id, name, rarity, color, img}]
        avatar: avatar || '',
        stats: stats || {},
        updatedAt: new Date().toISOString(),
      };

      if (idx >= 0) {
        record.players[idx] = { ...record.players[idx], ...playerData };
      } else {
        record.players.push(playerData);
      }

      // Limit 500 players, buang yang deckPower paling rendah
      if (record.players.length > 500) {
        record.players.sort((a, b) => b.deckPower - a.deckPower);
        record.players = record.players.slice(0, 500);
      }

      await writeBin(binId, record);
      return res.status(200).json({ success: true });
    }

  } catch (e) {
    console.error('leaderboard.js error:', e);
    return res.status(500).json({ error: e.message });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
