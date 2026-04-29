// api/trade.js — Vercel Serverless Function (Trade Kartu)
const JSONBIN_API_KEY = "$2a$10$.YFrLFivKiL4oHkYlXXZ7OZu0yDi2xC.sLg0SNS0DRlWGeUmtxYpq";
const TRADE_BIN_ID = process.env.TRADE_BIN_ID; // Set ini di Vercel env vars

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Content-Type": "application/json",
};

// Cache binId supaya tidak re-create setiap request
let cachedBinId = null;

async function getBinId() {
  if (TRADE_BIN_ID) return TRADE_BIN_ID;
  if (cachedBinId) return cachedBinId;
  const res = await fetch("https://api.jsonbin.io/v3/b", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_API_KEY,
      "X-Bin-Name": "rakha-gacha-trades",
      "X-Private": "false",
    },
    body: JSON.stringify({ trades: [] }),
  });
  const data = await res.json();
  cachedBinId = data.metadata.id;
  console.log("TRADE BIN CREATED:", cachedBinId);
  return cachedBinId;
}

async function readData(binId) {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    headers: { "X-Master-Key": JSONBIN_API_KEY },
  });
  const data = await res.json();
  return data.record || { trades: [] };
}

async function writeData(binId, record) {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_API_KEY,
    },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error("JSONBin write failed: " + res.status);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, cors);
    res.end();
    return;
  }
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const binId = await getBinId();
    const record = await readData(binId);
    if (!record.trades) record.trades = [];

    // Clean up old trades (> 24 jam) dan completed/cancelled (> 1 jam)
    const now = Date.now();
    record.trades = record.trades.filter(t => {
      const age = now - new Date(t.createdAt).getTime();
      if (t.status === "pending" && age > 24 * 60 * 60 * 1000) return false;
      if ((t.status === "completed" || t.status === "cancelled") && age > 60 * 60 * 1000) return false;
      return true;
    });

    // ─── GET — ambil semua trade offer yang ada (atau filter by playerName) ───
    if (req.method === "GET") {
      const { player, id } = req.query || {};

      // Cek trade spesifik by ID
      if (id) {
        const trade = record.trades.find(t => t.id === id);
        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }
        res.status(200).json(trade);
        return;
      }

      // Semua trade yang pending, atau filter yang bukan milik player sendiri
      let trades = record.trades.filter(t => t.status === "pending");
      if (player) {
        // Return: trades from others (bisa di-accept), plus trades milik sendiri
        trades = record.trades.filter(t =>
          t.status === "pending" || t.fromPlayer === player
        );
      }
      res.status(200).json(trades);
      return;
    }

    // ─── POST — buat trade offer baru ───
    if (req.method === "POST") {
      const { fromPlayer, offeredCard, wantedCard, note } = req.body || {};

      if (!fromPlayer || !offeredCard || !wantedCard) {
        res.status(400).json({ error: "Missing required fields: fromPlayer, offeredCard, wantedCard" });
        return;
      }

      // Max 3 active trade per player
      const myActiveOffers = record.trades.filter(
        t => t.fromPlayer === fromPlayer && t.status === "pending"
      );
      if (myActiveOffers.length >= 3) {
        res.status(400).json({ error: "Maksimal 3 trade offer aktif per player!" });
        return;
      }

      const tradeId = "trade_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const trade = {
        id: tradeId,
        fromPlayer,
        offeredCard,   // { id, name, rarity, color, img }
        wantedCard,    // { id, name, rarity, color, img }
        note: note || "",
        status: "pending",  // pending | accepted | completed | cancelled
        createdAt: new Date().toISOString(),
        acceptedBy: null,
        completedAt: null,
      };

      record.trades.unshift(trade);
      if (record.trades.length > 100) record.trades = record.trades.slice(0, 100);
      await writeData(binId, record);

      res.status(200).json({ success: true, trade });
      return;
    }

    // ─── PATCH — accept atau cancel trade ───
    if (req.method === "PATCH") {
      const { id, action, acceptedBy } = req.body || {};

      if (!id || !action) {
        res.status(400).json({ error: "Missing id or action" });
        return;
      }

      const idx = record.trades.findIndex(t => t.id === id);
      if (idx === -1) {
        res.status(404).json({ error: "Trade not found" });
        return;
      }

      const trade = record.trades[idx];

      if (action === "accept") {
        if (trade.status !== "pending") {
          res.status(400).json({ error: "Trade sudah tidak tersedia" });
          return;
        }
        if (trade.fromPlayer === acceptedBy) {
          res.status(400).json({ error: "Tidak bisa accept trade sendiri!" });
          return;
        }
        trade.status = "accepted";
        trade.acceptedBy = acceptedBy;
        trade.acceptedAt = new Date().toISOString();
      } else if (action === "complete") {
        trade.status = "completed";
        trade.completedAt = new Date().toISOString();
      } else if (action === "cancel") {
        if (trade.fromPlayer !== acceptedBy && trade.status !== "accepted") {
          res.status(403).json({ error: "Tidak bisa cancel trade ini" });
          return;
        }
        trade.status = "cancelled";
        trade.cancelledAt = new Date().toISOString();
      }

      record.trades[idx] = trade;
      await writeData(binId, record);
      res.status(200).json({ success: true, trade });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("Trade API error:", e);
    res.status(500).json({ error: e.message });
  }
};
