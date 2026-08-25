import http from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DIR, KOKORO_CACHE, PUBLIC_PORT } from "./config.mjs";
import { createChatterboxManager } from "./chatterbox-manager.mjs";
import { createSapiManager } from "./sapi-manager.mjs";
import { listen, readBody } from "./http-util.mjs";
import { readTtsPreferences, writeTtsPreferences } from "./preferences.mjs";
import * as registry from "./registry.mjs";
import { readHistory } from "./store.mjs";

// Changes every time the front (re)starts — i.e. every redeploy/reload. The window
// records the first value it sees and reloads itself when it changes, so an open app
// window always ends up running the freshly served JS instead of stale code.
const BOOT = Date.now();
const TTS_CORE_SOURCE = readFile(join(DIR, "tts-core.mjs"), "utf8");
const KOKORO_WORKER_SOURCE = readFile(join(DIR, "kokoro-worker.mjs"), "utf8");
const KOKORO_HF_BASE = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/";
const cacheDownloads = new Map();

function safeKokoroPath(value) {
    const path = String(value || "").replaceAll("\\", "/");
    if (!path || path.startsWith("/") || path.split("/").includes("..") || !/^[A-Za-z0-9._/-]+$/.test(path)) {
        throw new Error("invalid Kokoro asset path");
    }
    return path;
}

async function ensureKokoroAsset(relativePath) {
    const target = join(KOKORO_CACHE, ...relativePath.split("/"));
    try {
        await stat(target);
        return target;
    } catch {}
    if (cacheDownloads.has(relativePath)) return cacheDownloads.get(relativePath);
    const download = (async () => {
        await mkdir(dirname(target), { recursive: true });
        const response = await fetch(`${KOKORO_HF_BASE}${relativePath}`);
        if (!response.ok) throw new Error(`Kokoro asset download failed (${response.status})`);
        const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
        await rename(temporary, target);
        return target;
    })().finally(() => cacheDownloads.delete(relativePath));
    cacheDownloads.set(relativePath, download);
    return download;
}

async function serveKokoroAsset(relativePath, res) {
    const path = await ensureKokoroAsset(safeKokoroPath(relativePath));
    const info = await stat(path);
    res.writeHead(200, {
        "Content-Type": path.endsWith(".json") ? "application/json" : "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "public, max-age=31536000, immutable",
    });
    createReadStream(path).pipe(res);
}

function sendJson(res, status, obj) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
}

async function readJson(req) {
    const raw = await readBody(req);
    if (!raw.trim()) return {};
    return JSON.parse(raw);
}

function pipeTurn(session, body, res) {
    const upstream = http.request(
        {
            hostname: "127.0.0.1",
            port: session.internalPort,
            path: "/turn",
            method: "POST",
            headers: { "Content-Type": "application/json" },
        },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
        },
    );

    upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "session unavailable" }));
    });
    upstream.end(JSON.stringify(body));
}

const SSE_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
};

// Keep an SSE socket open even when there's no target session yet, so the browser
// EventSource doesn't reconnect-storm; it reconnects with a session once one exists.
function idleListen(res) {
    res.writeHead(200, SSE_HEADERS);
    res.write(": vox-listen idle\n\n");
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25_000);
    res.on("close", () => clearInterval(ping));
}

function pipeListen(session, res) {
    const upstream = http.request(
        { hostname: "127.0.0.1", port: session.internalPort, path: "/listen", method: "GET" },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
        },
    );
    upstream.on("error", () => { try { res.end(); } catch {} });
    res.on("close", () => { try { upstream.destroy(); } catch {} });
    upstream.end();
}

export async function ensureFront({ selfId, selfInternalPort, servePage, localTurn, localListen }) {
    if (registry.isFrontAlive()) return { hosting: false };
    const chatterbox = createChatterboxManager();
    const sapi = createSapiManager();

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");

            if (req.method === "GET" && url.pathname === "/") {
                servePage(res);
                return;
            }

            if (req.method === "GET" && url.pathname === "/tts-core.mjs") {
                res.writeHead(200, {
                    "Content-Type": "text/javascript; charset=utf-8",
                    "Cache-Control": "no-cache",
                });
                res.end(await TTS_CORE_SOURCE);
                return;
            }

            if (req.method === "GET" && url.pathname === "/kokoro-worker.mjs") {
                res.writeHead(200, {
                    "Content-Type": "text/javascript; charset=utf-8",
                    "Cache-Control": "no-cache",
                });
                res.end(await KOKORO_WORKER_SOURCE);
                return;
            }

            if (req.method === "GET" && url.pathname === "/kokoro-cache") {
                await serveKokoroAsset(url.searchParams.get("path"), res);
                return;
            }

            if (req.method === "GET" && url.pathname === "/preferences") {
                sendJson(res, 200, await readTtsPreferences());
                return;
            }

            if (req.method === "POST" && url.pathname === "/preferences") {
                sendJson(res, 200, await writeTtsPreferences(await readJson(req)));
                return;
            }

            if (req.method === "GET" && url.pathname === "/sapi/voices") {
                sendJson(res, 200, { supported: sapi.supported, voices: await sapi.voices() });
                return;
            }

            if (req.method === "POST" && url.pathname === "/sapi/speak") {
                sendJson(res, 200, await sapi.speak(await readJson(req)));
                return;
            }

            if (req.method === "POST" && url.pathname === "/sapi/cancel") {
                sapi.cancel();
                sendJson(res, 200, { canceled: true });
                return;
            }

            if (req.method === "GET" && url.pathname === "/chatterbox/status") {
                sendJson(res, 200, chatterbox.status());
                return;
            }

            if (req.method === "POST" && url.pathname === "/chatterbox/start") {
                try {
                    sendJson(res, 200, await chatterbox.start());
                } catch (error) {
                    sendJson(res, 503, { ...chatterbox.status(), error: error?.message || String(error) });
                }
                return;
            }

            if (req.method === "POST" && url.pathname === "/chatterbox/cancel") {
                const body = await readJson(req);
                await chatterbox.cancel(String(body.requestId || ""));
                sendJson(res, 200, { canceled: true });
                return;
            }

            if (req.method === "POST" && url.pathname === "/chatterbox/synthesize") {
                const body = await readJson(req);
                const controller = new AbortController();
                const abort = () => controller.abort(new Error("client disconnected"));
                req.once("aborted", abort);
                res.once("close", () => {
                    if (!res.writableEnded) abort();
                });
                const result = await chatterbox.synthesize(body, controller.signal);
                if (controller.signal.aborted || res.destroyed) return;
                res.writeHead(200, {
                    "Content-Type": "audio/wav",
                    "Content-Length": result.audio.length,
                    "X-Vox-Synthesis-Ms": result.synthesisMs ?? "",
                    "X-Vox-Response-Ms": result.responseMs ?? "",
                    "Cache-Control": "no-store",
                });
                res.end(result.audio);
                return;
            }

            if (req.method === "GET" && url.pathname === "/sessions") {
                sendJson(res, 200, { ...registry.list(), ver: BOOT });
                return;
            }

            // Full prior conversation for a session, read from the CLI's own store,
            // so the transcript shows everything that happened before Vox attached.
            if (req.method === "GET" && url.pathname === "/history") {
                const sid = url.searchParams.get("session") || registry.list().active || "";
                const turns = await readHistory(sid);
                sendJson(res, 200, { session: sid, turns });
                return;
            }

            // SSE channel that speaks assistant replies from typed CLI turns.
            if (req.method === "GET" && url.pathname === "/listen") {
                const listed = registry.list();
                const target = url.searchParams.get("session") || listed.active;
                if (!target) { idleListen(res); return; }
                if (target === selfId) { localListen(res); return; }
                const r = registry.load();
                const session = r.sessions[target];
                if (!session) { idleListen(res); return; }
                pipeListen(session, res);
                return;
            }

            if (req.method === "POST" && url.pathname === "/select") {
                const body = await readJson(req);
                const active = registry.setActive(body.session);
                sendJson(res, 200, { active });
                return;
            }

            if (req.method === "POST" && url.pathname === "/turn") {
                const body = await readJson(req);
                const listed = registry.list();
                const target = body.session || listed.active;
                if (!target) {
                    sendJson(res, 404, { error: "no active session" });
                    return;
                }
                if (target === selfId) {
                    await localTurn(body.text, res);
                    return;
                }

                const r = registry.load();
                const session = r.sessions[target];
                if (!session) {
                    sendJson(res, 404, { error: "session not found" });
                    return;
                }
                pipeTurn(session, body, res);
                return;
            }

            sendJson(res, 404, { error: "not found" });
        } catch (err) {
            sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
    });

    try {
        await listen(server, PUBLIC_PORT);
    } catch (err) {
        server.close();
        if (err?.code === "EADDRINUSE") return { hosting: false };
        throw err;
    }

    registry.setFront(process.pid);
    return { server, hosting: true, chatterbox, sapi };
}

export function closeFront(state) {
    state?.chatterbox?.close();
    state?.sapi?.close();
    state?.server?.close();
}
