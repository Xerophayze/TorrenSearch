const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, ".data", "torrensearch");
const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(DATA_DIR, "settings.json");
const MONITOR_STATE_FILE = process.env.MONITOR_STATE_FILE || path.join(DATA_DIR, "monitor-state.json");
const MAX_PROXY_BYTES = 12 * 1024 * 1024;
const MAX_SETTINGS_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const MONITOR_DEFAULT_INTERVAL_MS = 60 * 1000;
const MONITOR_MAX_ACTIONS = 40;
const PROXY_TOKEN = process.env.PROXY_TOKEN || "";
const PROWLARR_FALLBACK_URLS = (process.env.PROWLARR_FALLBACK_URLS || "http://192.168.76.10:9696,http://localhost:9696,http://[::1]:9696")
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const ALLOWED_PROXY_HOSTS = (process.env.ALLOWED_PROXY_HOSTS || "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

let monitorTimer = null;
let monitorRunning = false;
let monitorLastRun = null;
let monitorLastError = "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === "/proxy") {
      await proxyRequest(requestUrl, res);
      return;
    }

    if (requestUrl.pathname === "/magnet") {
      await magnetRequest(requestUrl, res);
      return;
    }

    if (requestUrl.pathname === "/settings") {
      await settingsRequest(req, res);
      return;
    }

    if (requestUrl.pathname.startsWith("/qb/")) {
      await qbRequest(req, requestUrl, res);
      return;
    }

    serveStatic(requestUrl, res);
  } catch (error) {
    sendText(res, 500, error.message || "Internal server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TorrenSearch running at http://${HOST}:${PORT}`);
  console.log(`Same-origin CORS proxy: http://${HOST}:${PORT}/proxy?url={url}`);
  console.log(`Torrent-to-magnet resolver: http://${HOST}:${PORT}/magnet?url={url}`);
  console.log(`Backend settings file: ${SETTINGS_FILE}`);
  console.log(`Slow torrent monitor state: ${MONITOR_STATE_FILE}`);
  if (PROXY_TOKEN) console.log("Proxy token protection is enabled.");
  if (ALLOWED_PROXY_HOSTS.length) console.log(`Allowed proxy hosts: ${ALLOWED_PROXY_HOSTS.join(", ")}`);
});

startSlowTorrentMonitor();

function serveStatic(requestUrl, res) {
  const requestedPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const resolved = path.resolve(ROOT, `.${requestedPath}`);

  if (!resolved.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      sendText(res, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : error.message);
      return;
    }

    res.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(resolved).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

async function settingsRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET") {
    try {
      sendJson(res, 200, await readSavedSettings());
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 200, {});
        return;
      }
      sendText(res, 500, `Settings read failed: ${error.message}`);
    }
    return;
  }

  if (req.method === "PUT") {
    try {
      const body = await readRequestBody(req, MAX_SETTINGS_BYTES);
      const parsed = JSON.parse(body || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        sendText(res, 400, "Settings must be a JSON object");
        return;
      }
      await fs.promises.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
      await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(parsed, null, 2), "utf8");
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendText(res, 500, `Settings save failed: ${error.message}`);
    }
    return;
  }

  sendText(res, 405, "Method not allowed");
}

async function readSavedSettings() {
  const raw = await fs.promises.readFile(SETTINGS_FILE, "utf8");
  return JSON.parse(raw);
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function qbRequest(req, requestUrl, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  try {
    if (requestUrl.pathname === "/qb/test" && req.method === "POST") {
      try {
        const client = await createQbClient();
        const appVersion = await client.text("/api/v2/app/version");
        sendJson(res, 200, { ok: true, version: appVersion.trim() });
      } catch (error) {
        const diagnostics = await qbDiagnostics().catch((diagError) => ({ ok: false, error: diagError.message, results: [] }));
        sendJson(res, 502, { ok: false, error: error.message, diagnostics });
      }
      return;
    }

    if (requestUrl.pathname === "/qb/diagnostics" && req.method === "POST") {
      sendJson(res, 200, await qbDiagnostics());
      return;
    }

    if (requestUrl.pathname === "/qb/monitor" && req.method === "GET") {
      sendJson(res, 200, await monitorStatus());
      return;
    }

    if (requestUrl.pathname === "/qb/monitor/check" && req.method === "POST") {
      const body = JSON.parse(await readRequestBody(req, MAX_SETTINGS_BYTES) || "{}");
      const hash = normalizeHash(body.hash || body.hashes);
      if (!hash) {
        sendText(res, 400, "Missing hash");
        return;
      }
      sendJson(res, 200, await runManualSlowTorrentRecovery(hash));
      return;
    }

    if (requestUrl.pathname === "/qb/torrents" && req.method === "GET") {
      const client = await createQbClient();
      const query = new URLSearchParams();
      query.set("sort", requestUrl.searchParams.get("sort") || "added_on");
      query.set("reverse", requestUrl.searchParams.get("reverse") || "true");
      const torrents = await client.json(`/api/v2/torrents/info?${query}`);
      const transfer = await client.json("/api/v2/transfer/info").catch(() => ({}));
      sendJson(res, 200, { torrents, transfer });
      return;
    }

    if (requestUrl.pathname === "/qb/categories" && req.method === "GET") {
      const client = await createQbClient();
      const categories = await client.json("/api/v2/torrents/categories");
      sendJson(res, 200, categories);
      return;
    }

    if (requestUrl.pathname === "/qb/files" && req.method === "GET") {
      const hash = requestUrl.searchParams.get("hash") || "";
      if (!hash) {
        sendText(res, 400, "Missing hash");
        return;
      }
      const client = await createQbClient();
      sendJson(res, 200, await client.json(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`));
      return;
    }

    if (requestUrl.pathname === "/qb/details" && req.method === "GET") {
      const hash = requestUrl.searchParams.get("hash") || "";
      if (!hash) {
        sendText(res, 400, "Missing hash");
        return;
      }
      const client = await createQbClient();
      const encodedHash = encodeURIComponent(hash);
      const [properties, files, trackers, webseeds, pieceStates] = await Promise.all([
        client.json(`/api/v2/torrents/properties?hash=${encodedHash}`).catch((error) => ({ error: error.message })),
        client.json(`/api/v2/torrents/files?hash=${encodedHash}`).catch((error) => ({ error: error.message })),
        client.json(`/api/v2/torrents/trackers?hash=${encodedHash}`).catch((error) => ({ error: error.message })),
        client.json(`/api/v2/torrents/webseeds?hash=${encodedHash}`).catch(() => []),
        client.json(`/api/v2/torrents/pieceStates?hash=${encodedHash}`).catch(() => [])
      ]);
      const monitor = await monitorEntry(hash).catch(() => null);
      sendJson(res, 200, {
        properties,
        files: Array.isArray(files) ? files : [],
        filesError: Array.isArray(files) ? "" : files.error,
        trackers: Array.isArray(trackers) ? trackers : [],
        trackersError: Array.isArray(trackers) ? "" : trackers.error,
        webseeds: Array.isArray(webseeds) ? webseeds : [],
        pieceStates: Array.isArray(pieceStates) ? summarizePieceStates(pieceStates) : null,
        monitor
      });
      return;
    }

    if (requestUrl.pathname === "/qb/trackers" && req.method === "GET") {
      const hash = requestUrl.searchParams.get("hash") || "";
      if (!hash) {
        sendText(res, 400, "Missing hash");
        return;
      }
      const client = await createQbClient();
      sendJson(res, 200, await client.json(`/api/v2/torrents/trackers?hash=${encodeURIComponent(hash)}`));
      return;
    }

    if (requestUrl.pathname === "/qb/add" && req.method === "POST") {
      const body = JSON.parse(await readRequestBody(req, MAX_SETTINGS_BYTES) || "{}");
      if (!body.urls) {
        sendText(res, 400, "Missing urls");
        return;
      }
      const settings = await getQbSettings();
      const client = await createQbClient(settings);
      const form = new URLSearchParams();
      const category = Object.prototype.hasOwnProperty.call(body, "category")
        ? String(body.category || "").trim()
        : settings.qbCategory;
      form.set("urls", String(body.urls));
      if (category) form.set("category", category);
      if (settings.qbSavePath) form.set("savepath", settings.qbSavePath);
      form.set("paused", settings.qbAddPaused ? "true" : "false");
      form.set("sequentialDownload", settings.qbSequential ? "true" : "false");
      form.set("firstLastPiecePrio", settings.qbFirstLastPiece ? "true" : "false");
      await client.form("/api/v2/torrents/add", form);
      await rememberAddedTorrent(String(body.urls), body.metadata || { name: body.name, category });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname === "/qb/action" && req.method === "POST") {
      const body = JSON.parse(await readRequestBody(req, MAX_SETTINGS_BYTES) || "{}");
      const hashes = normalizeHashes(body.hashes);
      const action = String(body.action || "");
      if (!hashes && action !== "refresh") {
        sendText(res, 400, "Missing hashes");
        return;
      }
      const client = await createQbClient();
      await runQbAction(client, action, hashes, body);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    sendText(res, 502, `qBittorrent request failed: ${error.message}`);
  }
}

async function getQbSettings() {
  const settings = await readSavedSettings().catch(() => ({}));
  const url = String(settings.qbUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("qBittorrent URL is not configured");
  if (!/^https?:\/\//i.test(url)) throw new Error("qBittorrent URL must start with http:// or https://");
  return {
    qbUrl: url,
    qbApiKey: String(settings.qbApiKey || "").trim(),
    qbUsername: String(settings.qbUsername || ""),
    qbPassword: String(settings.qbPassword || ""),
    qbCategory: String(settings.qbCategory || "").trim(),
    qbSavePath: String(settings.qbSavePath || "").trim(),
    qbAddPaused: Boolean(settings.qbAddPaused),
    qbSequential: Boolean(settings.qbSequential),
    qbFirstLastPiece: Boolean(settings.qbFirstLastPiece)
  };
}

async function createQbClient(settings = null) {
  const qb = settings || await getQbSettings();
  const errors = [];
  for (const base of qbBaseCandidates(qb.qbUrl)) {
    try {
      return await createQbClientForBase({ ...qb, qbUrl: base });
    } catch (error) {
      errors.push(`${base}: ${error.message}`);
    }
  }
  throw new Error(errors.join("; "));
}

async function createQbClientForBase(qb) {
  const base = qb.qbUrl.replace(/\/+$/, "");
  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    throw new Error("qBittorrent URL is invalid");
  }

  if (qb.qbApiKey) {
    const auth = { apiKey: qb.qbApiKey };
    const client = createQbRequestClient(base, auth, origin);
    await client.text("/api/v2/app/version");
    return client;
  }

  const loginForm = new URLSearchParams();
  loginForm.set("username", qb.qbUsername);
  loginForm.set("password", qb.qbPassword);

  const loginResponse = await qbRawFetch(`${base}/api/v2/auth/login`, {
    method: "POST",
    body: loginForm,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "origin": origin,
      "referer": `${base}/`
    }
  });
  const loginText = await loginResponse.text();
  const cookie = parseQbCookie(loginResponse.headers.get("set-cookie"));
  const loginBody = loginText.trim();
  if (!loginResponse.ok || /^Fails\.?$/i.test(loginBody)) {
    throw new Error(`login failed${loginResponse.status ? ` HTTP ${loginResponse.status}` : ""}${loginBody ? `: ${loginBody}` : ""}`);
  }
  if (loginBody && !/^Ok\.?$/i.test(loginBody) && !cookie) {
    throw new Error(`login returned an unexpected response: ${loginBody.slice(0, 120)}`);
  }

  const client = createQbRequestClient(base, { cookie }, origin);

  await client.text("/api/v2/app/version");
  return client;
}

function createQbRequestClient(base, auth, origin) {
  return {
    async text(pathname) {
      return qbFetchText(base, pathname, auth, origin);
    },
    async json(pathname) {
      const text = await qbFetchText(base, pathname, auth, origin);
      return JSON.parse(text);
    },
    async form(pathname, form) {
      await qbFetchText(base, pathname, auth, origin, {
        method: "POST",
        body: form,
        headers: { "content-type": "application/x-www-form-urlencoded" }
      });
    }
  };
}

function parseQbCookie(header) {
  if (!header) return "";
  return header.split(";").find((part) => part.trim().startsWith("SID=")) || "";
}

function qbBaseCandidates(base) {
  const candidates = [base.replace(/\/+$/, "")];
  try {
    const url = new URL(candidates[0]);
    if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
      candidates.push(url.toString().replace(/\/+$/, ""));
    } else if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      candidates.push(url.toString().replace(/\/+$/, ""));
    }
  } catch {
    return candidates;
  }
  return [...new Set(candidates)];
}

async function qbDiagnostics() {
  const qb = await getQbSettings();
  const results = [];
  for (const base of qbBaseCandidates(qb.qbUrl)) {
    const result = { base, authMode: qb.qbApiKey ? "api-key" : "password", login: null, appVersionWithHeaders: null, appVersionWithoutHeaders: null };
    let origin;
    try {
      origin = new URL(base).origin;
      if (qb.qbApiKey) {
        const auth = { apiKey: qb.qbApiKey };
        result.login = {
          status: "api-key",
          ok: true,
          body: "Bearer API key",
          hasSidCookie: false
        };
        result.appVersionWithHeaders = await qbDiagnosticFetch(base, "/api/v2/app/version", auth, origin, true);
        result.appVersionWithoutHeaders = await qbDiagnosticFetch(base, "/api/v2/app/version", auth, origin, false);
        results.push(result);
        continue;
      }

      const loginForm = new URLSearchParams();
      loginForm.set("username", qb.qbUsername);
      loginForm.set("password", qb.qbPassword);
      const loginResponse = await qbRawFetch(`${base}/api/v2/auth/login`, {
        method: "POST",
        body: loginForm,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "origin": origin,
          "referer": `${base}/`
        }
      });
      const loginText = await loginResponse.text();
      const cookie = parseQbCookie(loginResponse.headers.get("set-cookie"));
      result.login = {
        status: loginResponse.status,
        ok: loginResponse.ok,
        body: loginText.trim().slice(0, 120),
        hasSidCookie: Boolean(cookie)
      };
      result.appVersionWithHeaders = await qbDiagnosticFetch(base, "/api/v2/app/version", { cookie }, origin, true);
      result.appVersionWithoutHeaders = await qbDiagnosticFetch(base, "/api/v2/app/version", { cookie }, origin, false);
    } catch (error) {
      result.error = error.message;
    }
    results.push(result);
  }
  return { ok: results.some((item) => item.appVersionWithHeaders?.ok || item.appVersionWithoutHeaders?.ok), results };
}

async function qbDiagnosticFetch(base, pathname, auth, origin, includeBrowserHeaders) {
  try {
    const response = await qbFetchWithHeaderMode(base, pathname, auth, origin, {}, includeBrowserHeaders);
    const body = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      body: body.trim().slice(0, 120)
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function qbFetchText(base, pathname, auth, origin, options = {}) {
  const response = await qbFetchWithHeaderMode(base, pathname, auth, origin, options, true);
  const text = await response.text();
  if (response.status === 403) {
    const retry = await qbFetchWithHeaderMode(base, pathname, auth, origin, options, false);
    const retryText = await retry.text();
    if (!retry.ok) throw new Error(`HTTP ${retry.status}: ${retryText.slice(0, 300)}`);
    return retryText;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function qbFetchWithHeaderMode(base, pathname, auth, origin, options, includeBrowserHeaders) {
  const headers = {
    "accept": "application/json,text/plain,*/*",
    ...(options.headers || {})
  };
  if (includeBrowserHeaders) {
    headers.origin = origin;
    headers.referer = `${base}/`;
  }
  if (auth?.cookie) headers.cookie = auth.cookie;
  if (auth?.apiKey) headers.authorization = `Bearer ${auth.apiKey}`;

  return qbRawFetch(`${base}${pathname}`, {
    method: options.method || "GET",
    body: options.body,
    headers
  });
}

async function qbRawFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("connection timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHashes(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("|");
  return String(value || "").trim();
}

function summarizePieceStates(states) {
  const total = states.length;
  let complete = 0;
  let active = 0;
  for (const state of states) {
    if (state === 2) complete += 1;
    else if (state === 1) active += 1;
  }
  return {
    total,
    complete,
    active,
    missing: Math.max(0, total - complete - active)
  };
}

async function runQbAction(client, action, hashes, body) {
  if (action === "start") {
    await qbActionWithFallback(client, "/api/v2/torrents/start", "/api/v2/torrents/resume", hashes);
    return;
  }
  if (action === "stop") {
    await qbActionWithFallback(client, "/api/v2/torrents/stop", "/api/v2/torrents/pause", hashes);
    return;
  }
  if (action === "forceStart" || action === "unforceStart") {
    const form = new URLSearchParams();
    form.set("hashes", hashes);
    form.set("value", action === "forceStart" ? "true" : "false");
    await client.form("/api/v2/torrents/setForceStart", form);
    return;
  }
  if (action === "reannounce") {
    await qbSimpleTorrentAction(client, "/api/v2/torrents/reannounce", hashes);
    return;
  }
  if (action === "recheck") {
    await qbSimpleTorrentAction(client, "/api/v2/torrents/recheck", hashes);
    return;
  }
  if (action === "addTrackers") {
    const trackers = normalizeTrackerList(body.trackers || body.urls || "");
    if (!trackers.length) throw new Error("No trackers provided");
    await addTrackersToTorrent(client, hashes.split("|")[0], trackers);
    return;
  }
  if (action === "delete") {
    const form = new URLSearchParams();
    form.set("hashes", hashes);
    form.set("deleteFiles", body.deleteFiles ? "true" : "false");
    await client.form("/api/v2/torrents/delete", form);
    return;
  }
  if (action === "setCategory") {
    const form = new URLSearchParams();
    form.set("hashes", hashes);
    form.set("category", String(body.category || "").trim());
    await client.form("/api/v2/torrents/setCategory", form);
    return;
  }
  throw new Error("Unsupported action");
}

async function qbActionWithFallback(client, primaryPath, fallbackPath, hashes) {
  try {
    await qbSimpleTorrentAction(client, primaryPath, hashes);
  } catch (error) {
    if (!/HTTP 404|HTTP 405/.test(error.message)) throw error;
    await qbSimpleTorrentAction(client, fallbackPath, hashes);
  }
}

async function qbSimpleTorrentAction(client, pathName, hashes) {
  const form = new URLSearchParams();
  form.set("hashes", hashes);
  await client.form(pathName, form);
}

function startSlowTorrentMonitor() {
  clearInterval(monitorTimer);
  monitorTimer = setInterval(() => {
    runSlowTorrentMonitor().catch((error) => {
      monitorLastError = error.message || String(error);
      console.error(`Slow torrent monitor failed: ${monitorLastError}`);
    });
  }, MONITOR_DEFAULT_INTERVAL_MS);
  runSlowTorrentMonitor().catch((error) => {
    monitorLastError = error.message || String(error);
  });
}

async function runSlowTorrentMonitor() {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    const rawSettings = await readSavedSettings().catch(() => ({}));
    const monitor = getMonitorSettings(rawSettings);
    if (!monitor.enabled) {
      monitorLastRun = new Date().toISOString();
      monitorLastError = "";
      return;
    }

    if (!monitorDue(monitor)) return;
    monitorLastRun = new Date().toISOString();

    const client = await createQbClient();
    const torrents = await client.json("/api/v2/torrents/info?sort=added_on&reverse=true");
    const state = await readMonitorState();
    state.lastRunAt = monitorLastRun;
    state.lastError = "";
    state.settings = {
      checkMinutes: monitor.checkMinutes,
      minBytesPerSecond: monitor.minBytesPerSecond,
      slowMinutes: monitor.slowMinutes,
      cooldownMinutes: monitor.cooldownMinutes
    };

    const seenHashes = new Set();
    for (const torrent of Array.isArray(torrents) ? torrents : []) {
      const hash = normalizeHash(torrent.hash);
      if (!hash) continue;
      seenHashes.add(hash);
      await evaluateTorrentForRecovery(client, state, rawSettings, monitor, torrent, hash);
    }

    pruneMonitorState(state, seenHashes);
    await writeMonitorState(state);
    monitorLastError = "";
  } catch (error) {
    monitorLastRun = new Date().toISOString();
    monitorLastError = error.message || String(error);
    const state = await readMonitorState().catch(() => defaultMonitorState());
    state.lastRunAt = monitorLastRun;
    state.lastError = monitorLastError;
    await writeMonitorState(state).catch(() => {});
    throw error;
  } finally {
    monitorRunning = false;
  }
}

function monitorDue(monitor) {
  if (!monitorLastRun) return true;
  const elapsed = Date.now() - Date.parse(monitorLastRun);
  return !Number.isFinite(elapsed) || elapsed >= monitor.checkMinutes * 60 * 1000;
}

async function runManualSlowTorrentRecovery(hash) {
  const settings = await readSavedSettings().catch(() => ({}));
  const monitor = getMonitorSettings({ ...settings, slowMonitorEnabled: true });
  const client = await createQbClient();
  const torrents = await client.json("/api/v2/torrents/info");
  const torrent = Array.isArray(torrents) ? torrents.find((item) => normalizeHash(item.hash) === hash) : null;
  if (!torrent) throw new Error("Torrent not found in qBittorrent");

  const state = await readMonitorState();
  state.lastRunAt = new Date().toISOString();
  state.lastError = "";
  const entry = await evaluateTorrentForRecovery(client, state, settings, monitor, torrent, hash, { forceRecovery: true });
  await writeMonitorState(state);
  return {
    ok: true,
    message: entry.lastAction || "Manual recovery checked this torrent.",
    candidateCount: Array.isArray(entry.candidates) ? entry.candidates.length : 0,
    torrent: entry
  };
}

async function evaluateTorrentForRecovery(client, state, settings, monitor, torrent, hash, options = {}) {
  const forceRecovery = Boolean(options.forceRecovery);
  const now = Date.now();
  const entry = state.torrents[hash] || defaultTorrentMonitorEntry();
  state.torrents[hash] = entry;
  entry.name = torrent.name || entry.name || hash;
  entry.hash = hash;
  entry.lastSeenAt = new Date(now).toISOString();
  entry.progress = Number(torrent.progress) || 0;
  entry.dlspeed = Number(torrent.dlspeed) || 0;
  entry.numSeeds = Number(torrent.num_seeds) || 0;
  entry.state = String(torrent.state || "");

  if (entry.metadata?.name) {
    entry.searchQuery = entry.metadata.searchQuery || entry.searchQuery || searchQueryFromTorrentName(entry.metadata.name);
  } else {
    entry.searchQuery = entry.searchQuery || searchQueryFromTorrentName(entry.name);
  }

  if (shouldIgnoreTorrent(torrent, monitor) && !forceRecovery) {
    entry.slowSince = "";
    entry.status = "ignored";
    return entry;
  }

  if (entry.dlspeed >= monitor.minBytesPerSecond && !forceRecovery) {
    entry.slowSince = "";
    entry.status = "healthy";
    return entry;
  }

  if (!entry.slowSince) entry.slowSince = new Date(now).toISOString();
  const slowElapsedMs = now - Date.parse(entry.slowSince);
  if (!forceRecovery && (!Number.isFinite(slowElapsedMs) || slowElapsedMs < monitor.slowMinutes * 60 * 1000)) {
    entry.status = "watching";
    return entry;
  }

  entry.status = forceRecovery ? "manual" : "slow";
  const lastActionMs = Date.parse(entry.lastActionAt || "");
  if (!forceRecovery && Number.isFinite(lastActionMs) && now - lastActionMs < monitor.cooldownMinutes * 60 * 1000) return entry;

  const actions = [];
  try {
    await qbSimpleTorrentAction(client, "/api/v2/torrents/reannounce", hash);
    actions.push("reannounce");
  } catch (error) {
    actions.push(`reannounce failed: ${error.message}`);
  }

  const trackers = normalizeTrackerList(settings.trackers || []);
  if (monitor.addTrackers && trackers.length) {
    try {
      await addTrackersToTorrent(client, hash, trackers);
      actions.push(`add ${trackers.length} tracker${trackers.length === 1 ? "" : "s"}`);
    } catch (error) {
      actions.push(`add trackers failed: ${error.message}`);
    }
  }

  if (monitor.searchAlternatives) {
    try {
      entry.candidates = await searchAlternativeTorrents(settings, torrent, entry);
      entry.lastAlternativeSearchAt = new Date(now).toISOString();
      entry.lastAlternativeSearchError = "";
      actions.push(`search alternatives (${entry.candidates.length})`);
    } catch (error) {
      entry.lastAlternativeSearchAt = new Date(now).toISOString();
      entry.lastAlternativeSearchError = error.message;
      actions.push(`search alternatives failed: ${error.message}`);
    }
  }

  entry.lastActionAt = new Date(now).toISOString();
  entry.lastAction = actions.join(", ");
  entry.actions = [
    {
      at: entry.lastActionAt,
      speed: entry.dlspeed,
      seeds: entry.numSeeds,
      action: entry.lastAction
    },
    ...(Array.isArray(entry.actions) ? entry.actions : [])
  ].slice(0, MONITOR_MAX_ACTIONS);
  return entry;
}

function shouldIgnoreTorrent(torrent, monitor) {
  const progress = Number(torrent.progress) || 0;
  const state = String(torrent.state || "").toLowerCase();
  if (progress >= monitor.ignoreProgress) return true;
  if (monitor.ignorePaused && (state.includes("pause") || state.includes("stop") || state.includes("queued"))) return true;
  if (state.includes("error") || state.includes("missing") || state.includes("check")) return true;
  return false;
}

async function addTrackersToTorrent(client, hash, trackers) {
  const form = new URLSearchParams();
  form.set("hash", hash);
  form.set("urls", trackers.join("\n"));
  await client.form("/api/v2/torrents/addTrackers", form);
}

async function monitorStatus() {
  const settings = await readSavedSettings().catch(() => ({}));
  const state = await readMonitorState().catch(() => defaultMonitorState());
  return {
    running: monitorRunning,
    lastRunAt: monitorLastRun || state.lastRunAt || "",
    lastError: monitorLastError || state.lastError || "",
    settings: getMonitorSettings(settings),
    torrents: Object.values(state.torrents || {})
      .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
      .slice(0, 100)
  };
}

async function monitorEntry(hash) {
  const state = await readMonitorState();
  return state.torrents?.[normalizeHash(hash)] || null;
}

function getMonitorSettings(settings = {}) {
  const checkMinutes = clampNumber(settings.slowMonitorCheckMinutes, 1, 240, 5);
  return {
    enabled: Boolean(settings.slowMonitorEnabled),
    checkMinutes,
    minBytesPerSecond: clampNumber(settings.slowMonitorMinBytesPerSecond, 1024, 1024 * 1024 * 1024, 512 * 1024),
    slowMinutes: clampNumber(settings.slowMonitorSlowMinutes, 1, 1440, 10),
    cooldownMinutes: clampNumber(settings.slowMonitorCooldownMinutes, 5, 10080, 60),
    ignoreProgress: clampNumber(settings.slowMonitorIgnoreProgress, 0.1, 1, 0.95),
    ignorePaused: settings.slowMonitorIgnorePaused !== false,
    addTrackers: Boolean(settings.slowMonitorAddTrackers),
    searchAlternatives: Boolean(settings.slowMonitorSearchAlternatives)
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function rememberAddedTorrent(urls, metadata = {}) {
  const hash = normalizeHash(extractInfoHash(urls) || metadata.infoHash);
  if (!hash) return;
  const state = await readMonitorState();
  const entry = state.torrents[hash] || defaultTorrentMonitorEntry();
  entry.hash = hash;
  entry.name = cleanDisplayName(metadata.name || entry.name || "");
  entry.metadata = {
    ...entry.metadata,
    name: cleanDisplayName(metadata.name || entry.metadata?.name || ""),
    searchQuery: cleanDisplayName(metadata.searchQuery || entry.metadata?.searchQuery || ""),
    contentType: cleanDisplayName(metadata.contentType || entry.metadata?.contentType || ""),
    source: cleanDisplayName(metadata.source || entry.metadata?.source || ""),
    sizeBytes: Number(metadata.sizeBytes || entry.metadata?.sizeBytes || 0),
    seeders: Number(metadata.seeders || entry.metadata?.seeders || 0),
    addedAt: new Date().toISOString()
  };
  entry.searchQuery = entry.metadata.searchQuery || searchQueryFromTorrentName(entry.metadata.name || entry.name);
  state.torrents[hash] = entry;
  await writeMonitorState(state);
}

async function searchAlternativeTorrents(settings, torrent, entry) {
  if (!settings.prowlarrUrl || !settings.prowlarrKey) return [];
  const query = entry.searchQuery || searchQueryFromTorrentName(torrent.name);
  if (!query) return [];
  const categories = torznabCategoryIds(entry.metadata?.contentType || torrent.category || "");
  const searches = searchQueryVariants(query, entry.metadata?.name || torrent.name || "");
  const results = [];
  const seen = new Set();
  for (const search of searches) {
    const json = await searchProwlarr(settings, search, categories);
    for (const item of Array.isArray(json) ? json : []) {
      const candidate = normalizeProwlarrCandidate(item);
      const key = candidate.infoHash || `${candidate.name}:${candidate.sizeBytes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(candidate);
    }
    if (results.length >= 50) break;
  }
  return results
    .filter((item) => isBetterCandidate(item, torrent, entry))
    .sort((a, b) => (b.seeders - a.seeders) || (b.score - a.score))
    .slice(0, 8);
}

async function searchProwlarr(settings, query, categories) {
  const url = new URL(`${String(settings.prowlarrUrl).replace(/\/+$/, "")}/api/v1/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("type", "search");
  url.searchParams.set("apikey", settings.prowlarrKey);
  url.searchParams.set("limit", String(normalizeProwlarrLimit(settings.prowlarrLimit)));
  if (categories.length) url.searchParams.set("categories", categories.join(","));
  const response = await fetchProxyPayload(url);
  return JSON.parse(response.body.toString("utf8"));
}

function normalizeProwlarrLimit(value) {
  return Math.min(500, Math.max(20, Math.floor(Number(value) || 100)));
}

function searchQueryVariants(query, name) {
  const variants = [query, simplifyTorrentQuery(query), simplifyTorrentQuery(name)]
    .map((item) => cleanDisplayName(item).toLowerCase())
    .filter(Boolean);
  return [...new Set(variants)].slice(0, 3);
}

function simplifyTorrentQuery(value) {
  const terms = searchTerms(value);
  const keep = [];
  for (const term of terms) {
    if (/^(1080p|720p|2160p|4k|s\d{1,2}|s\d{1,2}e\d{1,2}|\d{4})$/i.test(term)) {
      keep.push(term);
      continue;
    }
    if (/^(bluray|bdrip|web-dl|webdl|x26[45]|h26[45]|hevc|avc|aac|ac3|multi|proper|repack)$/i.test(term)) continue;
    keep.push(term);
    if (keep.length >= 6) break;
  }
  return keep.join(" ");
}

function normalizeProwlarrCandidate(item) {
  const magnet = item.magnetUrl || item.magnet || (String(item.downloadUrl || "").startsWith("magnet:") ? item.downloadUrl : "");
  const infoHash = normalizeHash(item.infoHash || item.infohash || extractInfoHash(magnet));
  const name = cleanDisplayName(item.title || item.name || "Unnamed result");
  return {
    name,
    infoHash,
    seeders: Number(item.seeders || item.grabs || 0),
    leechers: Number(item.leechers || item.peers || 0),
    sizeBytes: Number(item.size || 0),
    source: item.indexer || item.indexerName || "Prowlarr",
    downloadUrl: item.downloadUrlLocal || item.downloadUrl || "",
    magnet,
    score: Number(item.sortTitle ? 1 : 0)
  };
}

function isBetterCandidate(candidate, torrent, entry) {
  if (!candidate.infoHash || candidate.infoHash === normalizeHash(torrent.hash)) return false;
  if (candidate.seeders <= Math.max(Number(torrent.num_seeds || 0), Number(entry.metadata?.seeders || 0), 0)) return false;
  if (!similarTorrentName(candidate.name, entry.metadata?.name || torrent.name || "")) return false;
  const currentSize = Number(torrent.size || entry.metadata?.sizeBytes || 0);
  if (currentSize && candidate.sizeBytes) {
    const ratio = candidate.sizeBytes / currentSize;
    if (ratio < 0.65 || ratio > 1.45) return false;
  }
  candidate.score = candidate.seeders + nameOverlapScore(candidate.name, entry.metadata?.name || torrent.name || "");
  return true;
}

function similarTorrentName(a, b) {
  return nameOverlapScore(a, b) >= 2;
}

function nameOverlapScore(a, b) {
  const aTerms = new Set(searchTerms(a).filter((term) => term.length > 2));
  const bTerms = searchTerms(b).filter((term) => term.length > 2);
  return bTerms.filter((term) => aTerms.has(term)).length;
}

function searchQueryFromTorrentName(name) {
  return searchTerms(name)
    .filter((term) => !/^(x26[45]|h26[45]|hevc|aac|dts|web|webrip|bluray|brrip|hdrip|proper|repack|rarbg|yts|eztv)$/i.test(term))
    .slice(0, 8)
    .join(" ");
}

function searchTerms(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function torznabCategoryIds(contentType) {
  const map = {
    movies: [2000],
    tv: [5000],
    anime: [5070],
    music: [3000],
    games: [1000],
    software: [4000],
    books: [7000],
    adult: [6000]
  };
  return map[String(contentType || "").toLowerCase()] || [];
}

function extractInfoHash(value) {
  const text = String(value || "");
  const match = text.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/);
  return match ? match[1] : "";
}

function normalizeHash(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTrackerList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))];
}

async function readMonitorState() {
  try {
    const raw = await fs.promises.readFile(MONITOR_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultMonitorState(),
      ...parsed,
      torrents: parsed && typeof parsed.torrents === "object" && !Array.isArray(parsed.torrents) ? parsed.torrents : {}
    };
  } catch (error) {
    if (error.code === "ENOENT") return defaultMonitorState();
    throw error;
  }
}

async function writeMonitorState(state) {
  await fs.promises.mkdir(path.dirname(MONITOR_STATE_FILE), { recursive: true });
  await fs.promises.writeFile(MONITOR_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function defaultMonitorState() {
  return {
    version: 1,
    lastRunAt: "",
    lastError: "",
    settings: {},
    torrents: {}
  };
}

function defaultTorrentMonitorEntry() {
  return {
    hash: "",
    name: "",
    status: "new",
    slowSince: "",
    lastActionAt: "",
    lastAction: "",
    lastSeenAt: "",
    searchQuery: "",
    metadata: {},
    candidates: [],
    actions: []
  };
}

function pruneMonitorState(state, seenHashes) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [hash, entry] of Object.entries(state.torrents || {})) {
    if (seenHashes.has(hash)) continue;
    const lastSeen = Date.parse(entry.lastSeenAt || "");
    if (!Number.isFinite(lastSeen) || lastSeen < cutoff) delete state.torrents[hash];
  }
}

async function proxyRequest(requestUrl, res) {
  const targetRaw = requestUrl.searchParams.get("url");
  const providedToken = requestUrl.searchParams.get("token") || "";

  if (PROXY_TOKEN && providedToken !== PROXY_TOKEN) {
    sendText(res, 401, "Invalid or missing proxy token");
    return;
  }

  if (!targetRaw) {
    sendText(res, 400, "Missing url query parameter");
    return;
  }

  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    sendText(res, 400, "Invalid target URL");
    return;
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    sendText(res, 400, "Only http and https URLs are supported");
    return;
  }

  try {
    const upstream = await fetchProxyWithFallbacks(target);

    const headers = {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "content-type": upstream.contentType || "application/octet-stream"
    };

    res.writeHead(upstream.status, headers);
    res.end(upstream.body);
  } catch (error) {
    sendText(res, 502, `Proxy request failed: ${error.message}`);
  }
}

async function fetchProxyWithFallbacks(target) {
  const candidates = [target, ...prowlarrFallbackTargets(target)];
  const errors = [];

  for (const candidate of candidates) {
    if (ALLOWED_PROXY_HOSTS.length && !ALLOWED_PROXY_HOSTS.includes(candidate.hostname.toLowerCase())) {
      errors.push(`${candidate.origin}: target host is not allowed`);
      continue;
    }

    try {
      return await fetchProxyPayload(candidate);
    } catch (error) {
      errors.push(`${candidate.origin}: ${errorDetails(error)}`);
    }
  }

  throw new Error(errors.join("; "));
}

async function fetchProxyPayload(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "accept": "*/*",
        "user-agent": "TorrenSearch local proxy"
      }
    });

    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);

    const reader = upstream.body.getReader();
    let received = 0;
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_PROXY_BYTES) throw new Error("Response too large");
      chunks.push(value);
    }

    return {
      status: upstream.status,
      contentType: upstream.headers.get("content-type") || "application/octet-stream",
      body: Buffer.concat(chunks)
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function magnetRequest(requestUrl, res) {
  const targetRaw = requestUrl.searchParams.get("url");
  const requestedName = requestUrl.searchParams.get("name") || "";
  const trackers = requestUrl.searchParams.getAll("tr").filter(Boolean);
  const format = requestUrl.searchParams.get("format") || "";
  const providedToken = requestUrl.searchParams.get("token") || "";

  if (PROXY_TOKEN && providedToken !== PROXY_TOKEN) {
    sendText(res, 401, "Invalid or missing proxy token");
    return;
  }

  if (!targetRaw) {
    sendText(res, 400, "Missing url query parameter");
    return;
  }

  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    sendText(res, 400, "Invalid target URL");
    return;
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    sendText(res, 400, "Only http and https URLs are supported");
    return;
  }

  if (ALLOWED_PROXY_HOSTS.length && !ALLOWED_PROXY_HOSTS.includes(target.hostname.toLowerCase())) {
    sendText(res, 403, "Target host is not allowed");
    return;
  }

  const name = cleanDisplayName(requestedName || target.searchParams.get("file") || "");

  try {
    const body = await fetchBufferWithFallbacks(target);
    const text = body.toString("utf8").trim();
    const magnet = enhanceMagnet(text.startsWith("magnet:")
      ? text
      : magnetFromTorrent(body, name), name, trackers);

    if (format === "json") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*"
      });
      res.end(JSON.stringify({ magnet }));
      return;
    }

    res.writeHead(302, {
      "location": magnet,
      "cache-control": "no-store"
    });
    res.end();
  } catch (error) {
    sendText(res, 502, `Magnet resolution failed: ${error.message}`);
  }
}

async function fetchBufferWithFallbacks(target) {
  const candidates = [target, ...prowlarrFallbackTargets(target)];
  const errors = [];

  for (const candidate of candidates) {
    try {
      return await fetchBuffer(candidate);
    } catch (error) {
      errors.push(`${candidate.origin}: ${errorDetails(error)}`);
    }
  }

  throw new Error(errors.join("; "));
}

function prowlarrFallbackTargets(target) {
  if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname) || target.port !== "9696") return [];
  return PROWLARR_FALLBACK_URLS.map((base) => {
    try {
      const fallback = new URL(base);
      fallback.pathname = target.pathname;
      fallback.search = target.search;
      fallback.hash = target.hash;
      return fallback;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function fetchBuffer(target, redirects = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "accept": "application/x-bittorrent,application/octet-stream,text/plain,*/*",
        "user-agent": "TorrenSearch magnet resolver"
      }
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location") || "";
      if (location.startsWith("magnet:")) return Buffer.from(location, "utf8");
      if (location && redirects < 5) return fetchBuffer(new URL(location, target), redirects + 1);
      throw new Error(`HTTP ${upstream.status} redirect without usable location`);
    }

    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);

    const reader = upstream.body.getReader();
    let received = 0;
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_PROXY_BYTES) throw new Error("Response too large");
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

function errorDetails(error) {
  const cause = error.cause;
  if (!cause) return error.message;
  const parts = [error.message];
  if (cause.code) parts.push(cause.code);
  if (cause.message && cause.message !== error.message) parts.push(cause.message);
  return parts.join(" - ");
}

function magnetFromTorrent(buffer, fallbackName) {
  const infoRange = findTorrentInfoRange(buffer);
  const hash = crypto.createHash("sha1").update(buffer.subarray(infoRange.start, infoRange.end)).digest("hex");
  const name = fallbackName || infoRange.name || "";
  const params = [`xt=urn:btih:${hash}`];
  if (name) params.push(`dn=${encodeURIComponent(name)}`);
  return `magnet:?${params.join("&")}`;
}

function enhanceMagnet(magnet, name, trackers = []) {
  const parsed = new URL(magnet);
  const currentName = parsed.searchParams.get("dn") || "";
  if (name && shouldReplaceMagnetName(currentName)) parsed.searchParams.set("dn", name);

  const existingTrackers = new Set(parsed.searchParams.getAll("tr"));
  for (const tracker of trackers) {
    if (!existingTrackers.has(tracker)) {
      parsed.searchParams.append("tr", tracker);
      existingTrackers.add(tracker);
    }
  }

  return parsed.toString();
}

function shouldReplaceMagnetName(value) {
  const name = cleanDisplayName(value);
  if (!name) return true;
  if (/^[a-fA-F0-9]{32,40}$/.test(name)) return true;
  if (/^[a-zA-Z2-7]{32}$/.test(name)) return true;
  if (name.length < 8) return true;
  return false;
}

function cleanDisplayName(value) {
  return String(value || "")
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findTorrentInfoRange(buffer) {
  let index = 0;
  if (buffer[index++] !== 0x64) throw new Error("Invalid torrent metadata");

  while (index < buffer.length && buffer[index] !== 0x65) {
    const key = readBencodeString(buffer, index);
    index = key.end;
    if (key.value === "info") {
      const start = index;
      const parsed = skipBencodeValue(buffer, index);
      const name = readTorrentName(buffer.subarray(start, parsed.end));
      return { start, end: parsed.end, name };
    }
    index = skipBencodeValue(buffer, index).end;
  }

  throw new Error("Torrent info dictionary not found");
}

function readTorrentName(infoBuffer) {
  try {
    let index = 1;
    while (index < infoBuffer.length && infoBuffer[index] !== 0x65) {
      const key = readBencodeString(infoBuffer, index);
      index = key.end;
      if (key.value === "name" || key.value === "name.utf-8") {
        const value = readBencodeString(infoBuffer, index);
        return value.value;
      }
      index = skipBencodeValue(infoBuffer, index).end;
    }
  } catch {
    return "";
  }
  return "";
}

function skipBencodeValue(buffer, index) {
  const byte = buffer[index];

  if (byte === 0x69) {
    const end = buffer.indexOf(0x65, index);
    if (end === -1) throw new Error("Invalid bencode integer");
    return { end: end + 1 };
  }

  if (byte === 0x6c || byte === 0x64) {
    index += 1;
    while (index < buffer.length && buffer[index] !== 0x65) {
      index = skipBencodeValue(buffer, index).end;
    }
    if (buffer[index] !== 0x65) throw new Error("Invalid bencode list/dictionary");
    return { end: index + 1 };
  }

  if (byte >= 0x30 && byte <= 0x39) {
    return readBencodeString(buffer, index);
  }

  throw new Error("Invalid bencode value");
}

function readBencodeString(buffer, index) {
  const colon = buffer.indexOf(0x3a, index);
  if (colon === -1) throw new Error("Invalid bencode string");
  const length = Number(buffer.toString("ascii", index, colon));
  if (!Number.isFinite(length) || length < 0) throw new Error("Invalid bencode string length");
  const start = colon + 1;
  const end = start + length;
  if (end > buffer.length) throw new Error("Truncated bencode string");
  return {
    value: buffer.toString("utf8", start, end),
    end
  };
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders()
  });
  res.end(text);
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders()
  });
  res.end(JSON.stringify(value));
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}
