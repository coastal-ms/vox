import http from "node:http";
import { readBody, listen } from "./http-util.mjs";
import { renderHtml } from "./renderer.mjs";
import { streamTurn, subscribe, eventDelta, extractReply, voxTurn } from "./turn.mjs";

const LISTEN_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
};

export async function startInternal({ session }) {
    // Passive broadcaster: speak assistant replies that come from TYPED CLI turns
    // (vox turns are streamed to the browser via /turn instead — see voxTurn).
    const clients = new Set();
    let deltaSeen = false;

    const broadcast = (obj) => {
        const frame = `data: ${JSON.stringify(obj)}\n\n`;
        for (const res of clients) { try { res.write(frame); } catch {} }
    };

    const unsubs = [
        subscribe(session, "assistant.message_delta", (ev) => {
            if (voxTurn.n > 0 || !clients.size) return;
            const delta = eventDelta(ev);
            if (!delta) return;
            deltaSeen = true;
            broadcast({ delta });
        }),
        subscribe(session, "assistant.message", (ev) => {
            if (voxTurn.n > 0 || !clients.size) { deltaSeen = false; return; }
            if (!deltaSeen) {
                const delta = extractReply(ev);
                if (delta) broadcast({ delta });
            }
            deltaSeen = false;
            broadcast({ done: true });
        }),
    ];

    function addListenClient(res) {
        res.writeHead(200, LISTEN_HEADERS);
        res.write(": vox-listen open\n\n");
        clients.add(res);
        const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25_000);
        const cleanup = () => { clearInterval(ping); clients.delete(res); };
        res.on("close", cleanup);
        res.on("error", cleanup);
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");

        try {
            if (req.method === "POST" && url.pathname === "/turn") {
                const raw = await readBody(req);
                const body = raw ? JSON.parse(raw) : {};
                await streamTurn(session, body?.text, res);
                return;
            }

            if (req.method === "GET" && url.pathname === "/listen") {
                addListenClient(res);
                return;
            }

            if (req.method === "GET") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(renderHtml(session?.id ?? "vox"));
                return;
            }

            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("not found");
        } catch (err) {
            if (!res.headersSent) {
                res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
            }
            res.end(err?.message || String(err));
        }
    });

    await listen(server, 0);
    return {
        server,
        port: server.address().port,
        addListenClient,
        close() {
            for (const unsub of unsubs.splice(0)) { try { unsub(); } catch {} }
            for (const res of clients) { try { res.end(); } catch {} }
            clients.clear();
            server.close();
        },
    };
}

export function closeInternal(state) {
    if (state && typeof state.close === "function") { state.close(); return; }
    state?.server?.close();
}
