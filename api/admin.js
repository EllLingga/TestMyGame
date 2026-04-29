// api/admin.js — Vercel Serverless Function
const JSONBIN_API_KEY = "$2a$10$.YFrLFivKiL4oHkYlXXZ7OZu0yDi2xC.sLg0SNS0DRlWGeUmtxYpq";
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,X-Admin-Password",
  "Access-Control-Allow-Methods": "GET,PATCH,OPTIONS",
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
  if (req.method === "OPTIONS") {
    res.writeHead(200, cors);
    res.end();
    return;
  }

  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  // Auth
  const pwd = (req.headers && (req.headers["x-admin-password"] || req.headers["X-Admin-Password"]))
    || (req.query && req.query.pwd);

  if (pwd !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const binId = await getBinId();
    const record = await readData(binId);
    if (!record.requests) record.requests = [];

    // GET — list semua request
    if (req.method === "GET") {
      res.status(200).json(record.requests);
      return;
    }

    // PATCH — approve atau reject
    if (req.method === "PATCH") {
      const { id, action, adminNote } = req.body;

      if (!id || !action) {
        res.status(400).json({ error: "Missing id or action" });
        return;
      }

      const idx = record.requests.findIndex(r => r.id === id);
      if (idx === -1) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      record.requests[idx].status = action === "approve" || action === "approved" ? "approved" : "rejected";
      record.requests[idx].adminNote = adminNote || "";
      record.requests[idx].updatedAt = new Date().toISOString();

      await writeData(binId, record);

      res.status(200).json({ success: true, request: record.requests[idx] });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
