// api/give.js — Vercel Serverless Function
// Pakai bin yang SAMA dengan topup/admin (JSONBIN_BIN_ID)
// Tidak perlu env variable tambahan!

const JSONBIN_API_KEY = "$2a$10$.YFrLFivKiL4oHkYlXXZ7OZu0yDi2xC.sLg0SNS0DRlWGeUmtxYpq";
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || "admin123";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,X-Admin-Password",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
};

async function getBinId() {
  if (process.env.JSONBIN_BIN_ID) return process.env.JSONBIN_BIN_ID;
  const res = await fetch("https://api.jsonbin.io/v3/b", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_API_KEY,
      "X-Bin-Name": "rakha-gacha-topup",
      "X-Private": "true",
    },
    body: JSON.stringify({ requests: [], gifts: [] }),
  });
  const data = await res.json();
  console.log("BIN ID (set ini sebagai JSONBIN_BIN_ID):", data.metadata?.id);
  return data.metadata?.id;
}

async function readBin(binId) {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    headers: { "X-Master-Key": JSONBIN_API_KEY },
  });
  const data = await res.json();
  return data.record || { requests: [], gifts: [] };
}

async function writeBin(binId, record) {
  await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_API_KEY,
    },
    body: JSON.stringify(record),
  });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(200, cors); res.end(); return; }
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const binId = await getBinId();
    const record = await readBin(binId);
    if (!record.gifts) record.gifts = [];

    // GET — game polling
    if (req.method === "GET") {
      const playerName = (req.query?.playerName || "").toLowerCase().trim();
      if (!playerName) { res.status(400).json({ error: "Missing playerName" }); return; }

      const myGifts = [];
      record.gifts = record.gifts.map(g => {
        if (g.status !== "pending") return g;
        const isForMe = !g.targetPlayer || g.targetPlayer.toLowerCase() === playerName;
        if (!isForMe) return g;
        if (!g.targetPlayer) {
          if ((g.claimedBy || []).includes(playerName)) return g;
          myGifts.push(g);
          return { ...g, claimedBy: [...(g.claimedBy || []), playerName] };
        }
        myGifts.push(g);
        return { ...g, status: "claimed", claimedAt: new Date().toISOString() };
      });

      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      record.gifts = record.gifts.filter(g =>
        g.status === "pending" || new Date(g.createdAt).getTime() > cutoff
      );
      if (record.gifts.length > 300) record.gifts = record.gifts.slice(0, 300);
      if (myGifts.length > 0) await writeBin(binId, record);

      res.status(200).json({ gifts: myGifts });
      return;
    }

    // POST — admin kirim hadiah
    if (req.method === "POST") {
      const pwd = req.headers?.["x-admin-password"] || req.query?.pwd;
      if (pwd !== ADMIN_PASSWORD) { res.status(401).json({ error: "Unauthorized" }); return; }

      const { type, targetPlayer, amount, cardId, qty } = req.body || {};
      if (!type || !["gems", "card"].includes(type)) {
        res.status(400).json({ error: "type harus 'gems' atau 'card'" }); return;
      }

      const gift = {
        id: "gift_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        type,
        targetPlayer: targetPlayer ? String(targetPlayer).trim() : "",
        amount:  type === "gems" ? Number(amount) : undefined,
        cardId:  type === "card" ? String(cardId)  : undefined,
        qty:     type === "card" ? (Number(qty) || 1) : undefined,
        status: "pending",
        claimedBy: [],
        createdAt: new Date().toISOString(),
      };

      record.gifts.unshift(gift);
      if (record.gifts.length > 300) record.gifts = record.gifts.slice(0, 300);
      await writeBin(binId, record);

      res.status(200).json({ success: true, giftId: gift.id });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("give.js error:", err);
    res.status(500).json({ error: err.message });
  }
};
