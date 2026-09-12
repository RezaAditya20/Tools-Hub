// Minimal proxy server untuk Streaming Player + TorrServer
// Usage: node streaming-server.js
// Buka: http://localhost:8091

const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const { execFile } = require("child_process");

const PROXY_PORT = 8091;
const ROOT = __dirname;
let TS_URL = "http://127.0.0.1:8090";

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/* ── Auto-detect TorrServer port ── */
function checkPort(host, port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(500);
    sock.on("connect", () => { sock.destroy(); resolve(true); });
    sock.on("timeout", () => { sock.destroy(); resolve(false); });
    sock.on("error", () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

let TS_PORT_CACHE = null;

async function findTorrServer() {
  // Return cached port if still alive
  if (TS_PORT_CACHE) {
    if (await checkPort("127.0.0.1", TS_PORT_CACHE)) return TS_PORT_CACHE;
    TS_PORT_CACHE = null;
  }
  // Parallel scan — all ports at once, return first hit
  const ports = [8090, 8091, 8092, 8093, 25600];
  const checks = ports.map(p => checkPort("127.0.0.1", p).then(ok => ok ? p : null));
  const results = await Promise.all(checks);
  const found = results.find(p => p !== null);
  if (found) TS_PORT_CACHE = found;
  return found || null;
}

/* ── Server ── */
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  /* Proxy TorrServer requests */
  if (req.url.startsWith("/ts/")) {
    const tsPath = req.url.slice(3);
    return proxyTorrServer(tsPath, req, res);
  }

  /* Health check */
  if (req.url === "/health") {
    const found = await findTorrServer();
    const ok = found !== null;
    if (ok) TS_URL = "http://127.0.0.1:" + found;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ torrserver: ok, port: found, url: TS_URL }));
  }

  /* Launch mpv */
  if (req.url === "/launch-mpv" && req.method === "POST") {
    let body = [];
    req.on("data", (c) => body.push(c));
    req.on("end", () => {
      try {
        const { url } = JSON.parse(Buffer.concat(body).toString());
        if (!url) { res.writeHead(400); return res.end(JSON.stringify({ error: "url required" })); }
        // Try mpv from PATH, or common Windows locations
        const mpvCandidates = [
          "mpv",
          path.join(process.env.LOCALAPPDATA || "", "mpv", "mpv.exe"),
          "C:\\Program Files\\mpv\\mpv.exe",
          path.join(process.env.USERPROFILE || "", "scoop", "apps", "mpv", "current", "mpv.exe"),
        ];
        let launched = false;
        function tryNext(i) {
          if (i >= mpvCandidates.length || launched) return;
          const bin = mpvCandidates[i];
          execFile(bin, [url, "--fullscreen"], { windowsHide: true }, (err) => {
            if (err && err.code === "ENOENT") tryNext(i + 1);
          });
          launched = true;
          console.log("  ▶ mpv launched: " + bin);
        }
        tryNext(0);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  /* Static file serving */
  let filePath = path.join(ROOT, req.url === "/" ? "/page/Streaming-Player.html" : req.url.split("?")[0]);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found: " + req.url);
  }
});

function proxyTorrServer(tsPath, req, res) {
  const tsParsed = new URL(TS_URL);
  console.log("  → " + req.method + " " + TS_URL + tsPath);

  let body = [];
  req.on("data", (chunk) => body.push(chunk));
  req.on("end", () => {
    body = Buffer.concat(body);

    // Forward semua headers penting dari browser ke TorrServer
    const fwdReqHeaders = {};
    if (req.headers["range"]) fwdReqHeaders["Range"] = req.headers["range"];
    if (req.headers["content-type"]) fwdReqHeaders["Content-Type"] = req.headers["content-type"];
    if (req.headers["content-length"]) fwdReqHeaders["Content-Length"] = req.headers["content-length"];
    if (req.headers["accept"]) fwdReqHeaders["Accept"] = req.headers["accept"];

    const opts = {
      hostname: tsParsed.hostname,
      port: tsParsed.port,
      path: tsPath,
      method: req.method,
      headers: fwdReqHeaders,
    };
    if (body.length > 0) opts.headers["Content-Length"] = body.length;

    const proxyReq = http.request(opts, (proxyRes) => {
      const ct = proxyRes.headers["content-type"] || "application/json";
      const cl = proxyRes.headers["content-length"];
      const cr = proxyRes.headers["content-range"];
      const isStream = ct.includes("video") || ct.includes("audio") || ct.includes("octet-stream");
      console.log("  ← " + proxyRes.statusCode + " " + ct + (cl ? " (" + cl + " bytes)" : "") + (isStream ? " [STREAM]" : ""));

      const fwdHeaders = { "Content-Type": ct };
      if (cl) fwdHeaders["Content-Length"] = cl;
      if (cr) fwdHeaders["Content-Range"] = cr;
      fwdHeaders["Accept-Ranges"] = "bytes";

      res.writeHead(proxyRes.statusCode, fwdHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (e) => {
      console.log("  ✗ ERROR: " + e.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({
        error: e.message,
        hint: "TorrServer tidak berjalan di " + TS_URL + ". Jalankan TorrServer.exe terlebih dahulu.",
      }));
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
}

/* ── Start ── */
(async () => {
  const found = await findTorrServer();
  if (found) {
    TS_URL = "http://127.0.0.1:" + found;
    console.log("\n  ✓ TorrServer ditemukan di port " + found);
  } else {
    console.log("\n  ✗ TorrServer tidak ditemukan! Jalankan TorrServer.exe terlebih dahulu.");
    console.log("    (dicoba di port 8090, 8091, 8092, 8093, 25600)");
  }

  server.listen(PROXY_PORT, () => {
    console.log("\n  Streaming Player server berjalan:");
    console.log("  → http://localhost:" + PROXY_PORT);
    console.log("  → TorrServer proxy: " + TS_URL + "\n");
  });
})();
