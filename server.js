"use strict";
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "party.json");

/* What can be stored: collection -> limits */
const COLS = {
  couples: { maxDocs: 100, maxBytes: 2000 },
  party:   { maxDocs: 1,   maxBytes: 1000,   id: /^state$/ },
  judges:  { maxDocs: 300, maxBytes: 300000 },
  sounds:  { maxDocs: 10,  maxBytes: 300000, id: /^s([1-9]|10)$/ }
};
const PATH_RE = /^([a-z]+)\/([A-Za-z0-9_\-:.]{1,80})$/;

/* ---------- Storage: one JSON file, written shortly after each change ---------- */
let docs = {};
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) docs = JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
  console.log(`Loaded ${Object.keys(docs).length} documents from ${FILE}`);
} catch (e) {
  console.error("Could not load saved party, starting fresh:", e.message);
  docs = {};
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(docs), (err) => {
      if (err) return console.error("Save failed:", err.message);
      fs.rename(tmp, FILE, (err2) => { if (err2) console.error("Save failed:", err2.message); });
    });
  }, 800);
}

/* ---------- HTTP ---------- */
const app = express();
app.disable("x-powered-by");
app.get("/health", (req, res) => res.json({ ok: true, docs: Object.keys(docs).length }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, file) {
    if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));
const server = http.createServer(app);

/* ---------- Realtime ---------- */
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 * 1024 });

function sendJSON(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg) {
  const s = JSON.stringify(msg);
  wss.clients.forEach((c) => { if (c.readyState === 1 && c.device) c.send(s); });
}
function check(p, ws) {
  const m = PATH_RE.exec(String(p || ""));
  if (!m) return "Bad path";
  const col = COLS[m[1]];
  if (!col) return "Unknown collection";
  if (col.id && !col.id.test(m[2])) return "Bad document id";
  if (m[1] === "judges" && m[2] !== ws.device) return "You can only change the judges on your own phone";
  return null;
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== "object") return;

    if (m.type === "hello") {
      if (typeof m.device !== "string" || !/^[A-Za-z0-9_\-]{6,80}$/.test(m.device)) return ws.close(1008, "Bad device id");
      ws.device = m.device;
      return sendJSON(ws, { type: "state", docs });
    }
    if (!ws.device) return;
    const fail = (code, message) => sendJSON(ws, { type: "error", id: m.id, code, message });

    if (m.type === "set") {
      const err = check(m.path, ws);
      if (err) return fail("rejected", err);
      if (!m.data || typeof m.data !== "object" || Array.isArray(m.data)) return fail("rejected", "Document must be an object");
      const col = m.path.split("/")[0], lim = COLS[col];
      const size = Buffer.byteLength(JSON.stringify(m.data));
      if (size > lim.maxBytes) return fail("quota_exceeded", "Too big");
      if (!(m.path in docs)) {
        const count = Object.keys(docs).filter((k) => k.startsWith(col + "/")).length;
        if (count >= lim.maxDocs) return fail("quota_exceeded", "Too many");
      }
      docs[m.path] = m.data;
      save();
      broadcast({ type: "change", path: m.path, data: m.data });
      return sendJSON(ws, { type: "ack", id: m.id });
    }
    if (m.type === "delete") {
      const err = check(m.path, ws);
      if (err) return fail("rejected", err);
      if (m.path in docs) {
        delete docs[m.path];
        save();
        broadcast({ type: "change", path: m.path, data: null });
      }
      return sendJSON(ws, { type: "ack", id: m.id });
    }
  });
});

/* Keep connections alive through Railway's proxy and drop dead phones */
const beat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 25000);
wss.on("close", () => clearInterval(beat));

function shutdown() {
  clearTimeout(saveTimer);
  try { fs.writeFileSync(FILE, JSON.stringify(docs)); } catch (e) {}
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(PORT, () => console.log(`Paddles Up listening on ${PORT}`));
