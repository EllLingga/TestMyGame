// api/topup.js — Vercel Serverless Function
const JSONBIN_API_KEY = "$2a$10$.YFrLFivKiL4oHkYlXXZ7OZu0yDi2xC.sLg0SNS0DRlWGeUmtxYpq";
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
};

async function getBinId() {
  if (JSONBIN_BIN_ID) return JSONBIN_BIN_ID;
  const res = await fetch("https://api.jsonbin.io/v3/b", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_API_KEY,
      "X-Bin-Name": "rakha-gacha-topup",
      "X-Private": "true",
    },
    body: JSON.stringify({ requests: [] }),
  });
  const data = await res.json();
  console.log("NEW BIN CREATED:", data.metadata.id);
  return data.metadata.id;
}

async function readData(binId) {
  const res = await fetch("https://api.jsonbin.io/v3/b/" + binId + "/latest", {
    headers: { "X-Master-Key": JSONBIN_API_KEY },
  });
  const data = await res.json();
  return data.record || { requests: [] };
}

async function writeData(binId, record) {
  await fetch("https://api.jsonbin.io/v3/b/" + binId, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_API_KEY,
    },
    body: JSON.stringify(record),
  });
}

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, cors);
    res.end();
    return;
  }

  // Set CORS headers
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const binId = await getBinId();
    const record = await readData(binId);
    if (!record.requests) record.requests = [];

    // GET — cek status request
    if (req.method === "GET") {
      const id = req.query && req.query.id;
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const found = record.requests.find(r => r.id === id);
      if (!found) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(200).json(found);
      return;
    }

    // POST — kirim request topup baru
    if (req.method === "POST") {
      const body = req.body;
      const { playerName, gems, amount, paymentMethod } = body;

      if (!playerName || !gems || !amount || !paymentMethod) {
        res.status(400).json({ error: "Missing fields" });
        return;
      }

      const id = "req_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
      const newReq = {
        id,
        playerName: String(playerName),
        gems: Number(gems),
        amount: Number(amount),
        paymentMethod: String(paymentMethod),
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminNote: "",
      };

      record.requests.unshift(newReq);
      if (record.requests.length > 200) record.requests = record.requests.slice(0, 200);
      await writeData(binId, record);

      res.status(200).json({ success: true, id, binId });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
