import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { CHATTERBOX_SIDECAR_FILE, CHATTERBOX_VOICES_DIR } from "./config.mjs";
import { readChatterboxConfig } from "./chatterbox-config.mjs";

const STARTUP_TIMEOUT_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

function messageOf(error) {
    return error?.message || String(error);
}

function abortContext(externalSignal, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);
    timeout.unref?.();
    const forward = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", forward, { once: true });
    return {
        signal: controller.signal,
        close() {
            clearTimeout(timeout);
            externalSignal?.removeEventListener("abort", forward);
        },
    };
}

export function createChatterboxManager({
    loadConfig = readChatterboxConfig,
    spawnProcess = spawn,
    fetchImpl = globalThis.fetch,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
    let child = null;
    let startPromise = null;
    let stopping = false;
    let state = "stopped";
    let port = null;
    let config = null;
    let error = "";
    let detail = "";
    let modelLoadMs = null;
    let lastSynthesisMs = null;
    let lastResponseMs = null;
    let startedAt = null;

    const status = () => ({
        state,
        error,
        detail,
        port,
        pid: child?.pid ?? null,
        referencePath: config?.referencePath ?? null,
        cachePath: config?.cachePath ?? null,
        modelLoadMs,
        lastSynthesisMs,
        lastResponseMs,
        startedAt,
    });

    function resetProcess(nextState = "stopped") {
        child = null;
        port = null;
        state = nextState;
    }

    async function start() {
        if (state === "ready" && child && port) return status();
        if (startPromise) return startPromise;

        startPromise = (async () => {
            state = "starting";
            error = "";
            detail = "Validating local configuration";
            stopping = false;
            config = await loadConfig();
            detail = "Loading the CPU model and authorized reference";
            startedAt = new Date().toISOString();

            const args = [
                CHATTERBOX_SIDECAR_FILE,
                "--host", "127.0.0.1",
                "--port", "0",
                "--reference", config.referencePath,
                "--voices-root", CHATTERBOX_VOICES_DIR,
                "--cache", config.cachePath,
                "--threads", String(config.cpuThreads),
            ];
            const spawned = spawnProcess(config.pythonPath, args, {
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env, PYTHONUNBUFFERED: "1" },
            });
            child = spawned;
            spawned.unref?.();
            spawned.stdin?.unref?.();

            const stderr = [];
            spawned.stderr?.on("data", (chunk) => {
                stderr.push(String(chunk).trim());
                if (stderr.length > 8) stderr.shift();
            });

            return new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                    fail(new Error(`Chatterbox startup timed out after ${Math.round(startupTimeoutMs / 1000)} seconds`));
                    try { spawned.kill(); } catch {}
                }, startupTimeoutMs);
                timer.unref?.();

                const finish = (fn, value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    fn(value);
                };
                const fail = (reason) => {
                    error = messageOf(reason);
                    if (stderr.length) error += ` (${stderr.join(" ").slice(-1200)})`;
                    detail = "";
                    try { spawned.kill(); } catch {}
                    resetProcess("error");
                    finish(reject, reason);
                };

                const lines = spawned.stdout
                    ? createInterface({ input: spawned.stdout, crlfDelay: Infinity })
                    : null;
                lines?.on("line", (line) => {
                    let event;
                    try { event = JSON.parse(line); } catch { return; }
                    if (event?.event === "status" && event?.detail) {
                        detail = String(event.detail);
                        return;
                    }
                    if (event?.event === "error") {
                        fail(new Error(String(event.error || "Chatterbox sidecar failed")));
                        return;
                    }
                    if (event?.event !== "ready") return;
                    const discovered = Number(event.port);
                    if (!Number.isInteger(discovered) || discovered < 1 || discovered > 65535) {
                        fail(new Error("Chatterbox sidecar reported an invalid port"));
                        return;
                    }
                    port = discovered;
                    modelLoadMs = Number.isFinite(Number(event.modelLoadMs))
                        ? Number(event.modelLoadMs)
                        : null;
                    detail = "CPU model loaded";
                    state = "ready";
                    finish(resolve, status());
                });
                spawned.once("error", fail);
                spawned.once("exit", (code, signal) => {
                    if (stopping) {
                        resetProcess("stopped");
                        finish(resolve, status());
                        return;
                    }
                    fail(new Error(`Chatterbox sidecar exited (${signal || code || "unknown"})`));
                });
            });
        })().catch((reason) => {
            if (state !== "error") {
                state = "error";
                error = messageOf(reason);
                detail = "";
            }
            throw reason;
        }).finally(() => {
            startPromise = null;
        });
        return startPromise;
    }

    async function sidecarRequest(path, init = {}, externalSignal, timeoutMs = requestTimeoutMs) {
        if (!port) throw new Error("Chatterbox sidecar is not ready");
        const abort = abortContext(externalSignal, timeoutMs);
        try {
            return await fetchImpl(`http://127.0.0.1:${port}${path}`, {
                ...init,
                signal: abort.signal,
            });
        } finally {
            abort.close();
        }
    }

    async function cancel(requestId) {
        if (!port || !requestId) return;
        try {
            await sidecarRequest("/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId }),
            }, undefined, 3000);
        } catch {}
    }

    async function synthesize({ text, requestId = randomUUID() }, signal) {
        const spoken = String(text ?? "").trim();
        if (!spoken) throw new Error("Chatterbox text is empty");
        if (spoken.length > 1200) throw new Error("Chatterbox text exceeds 1200 characters");
        const id = String(requestId || randomUUID()).slice(0, 80);
        await start();
        const began = Date.now();
        let aborted = false;
        const onAbort = () => {
            aborted = true;
            cancel(id);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            const response = await sidecarRequest("/synthesize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: spoken, requestId: id }),
            }, signal);
            if (!response.ok) {
                const body = await response.text();
                throw new Error(body || `Chatterbox synthesis failed (${response.status})`);
            }
            const audio = Buffer.from(await response.arrayBuffer());
            if (aborted || signal?.aborted) {
                throw signal?.reason || new Error("Chatterbox synthesis canceled");
            }
            if (!audio.length) throw new Error("Chatterbox returned empty audio");
            lastResponseMs = Date.now() - began;
            const measured = Number(response.headers.get("x-vox-synthesis-ms"));
            lastSynthesisMs = Number.isFinite(measured) ? measured : null;
            error = "";
            return {
                audio,
                requestId: id,
                synthesisMs: lastSynthesisMs,
                responseMs: lastResponseMs,
            };
        } catch (reason) {
            if (!signal?.aborted) error = messageOf(reason);
            throw reason;
        } finally {
            signal?.removeEventListener("abort", onAbort);
        }
    }

    function close() {
        stopping = true;
        startPromise = null;
        const active = child;
        if (!active) {
            resetProcess("stopped");
            return;
        }
        state = "stopping";
        try { active.stdin?.end(); } catch {}
        if (port) {
            sidecarRequest("/shutdown", { method: "POST" }, undefined, 1000).catch(() => {});
        }
        const timer = setTimeout(() => {
            if (child === active) {
                try { active.kill(); } catch {}
            }
        }, 1200);
        timer.unref?.();
        active.once("exit", () => clearTimeout(timer));
    }

    return { status, start, synthesize, cancel, close };
}
