import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { SAPI_HOST_FILE } from "./config.mjs";

export function createSapiManager({
    platform = process.platform,
    spawnProcess = spawn,
    hostFile = SAPI_HOST_FILE,
    startupTimeoutMs = 10_000,
} = {}) {
    let child = null;
    let starting = null;
    let ready = false;
    let voices = [];
    let requestN = 0;
    const pending = new Map();
    const supported = platform === "win32";

    function settlePending(error) {
        for (const request of pending.values()) {
            if (error) request.reject(error);
            else request.resolve({ canceled: true });
        }
        pending.clear();
    }

    function stop(error) {
        const running = child;
        child = null;
        starting = null;
        ready = false;
        voices = [];
        settlePending(error);
        if (running && !running.killed) running.kill();
    }

    function start() {
        if (!supported) return Promise.reject(new Error("SAPI 5 is available only on Windows"));
        if (child && ready) return Promise.resolve({ voices });
        if (starting) return starting;
        starting = new Promise((resolve, reject) => {
            const process = spawnProcess("powershell.exe", [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy", "Bypass",
                "-File", hostFile,
            ], {
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
            });
            child = process;
            let stderr = "";
            const lines = createInterface({ input: process.stdout });
            const timer = setTimeout(() => {
                fail(new Error(`SAPI host did not become ready within ${startupTimeoutMs} ms`));
            }, startupTimeoutMs);
            const fail = (error) => {
                clearTimeout(timer);
                if (starting) reject(error);
                stop(error);
            };
            process.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
            process.once("error", fail);
            process.once("exit", (code) => {
                if (child !== process) return;
                fail(new Error(stderr.trim() || `SAPI host exited (${code ?? "unknown"})`));
            });
            lines.on("line", (line) => {
                let message;
                try { message = JSON.parse(line); } catch { return; }
                if (message.type === "ready" || message.type === "voices") {
                    clearTimeout(timer);
                    voices = Array.isArray(message.voices) ? message.voices : [];
                    ready = true;
                    if (starting) {
                        resolve({ voices });
                        starting = null;
                    }
                    return;
                }
                const request = pending.get(String(message.id || ""));
                if (!request) return;
                pending.delete(String(message.id));
                if (message.type === "error") request.reject(new Error(message.error || "SAPI speech failed"));
                else request.resolve(message);
            });
        });
        return starting;
    }

    async function speak({ text, voice, rate }) {
        await start();
        const value = String(text || "").trim();
        if (!value) return { elapsedMs: 0 };
        const id = `s${Date.now().toString(36)}${(++requestN).toString(36)}`;
        const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        child.stdin.write(`${JSON.stringify({ type: "speak", id, text: value, voice, rate })}\n`);
        return result;
    }

    return {
        supported,
        start,
        voices: async () => supported ? (await start()).voices : [],
        speak,
        cancel: () => stop(),
        close: () => stop(),
    };
}
