import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createChatterboxManager } from "../chatterbox-manager.mjs";

function fakeProcess() {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.unref = () => {};
    child.kill = () => {
        queueMicrotask(() => child.emit("exit", 0, null));
        return true;
    };
    return child;
}

test("sidecar starts once, discovers its port, synthesizes, cancels, and closes", async () => {
    const child = fakeProcess();
    const requests = [];
    const fetchImpl = async (url, init = {}) => {
        requests.push({ url, init });
        if (url.endsWith("/synthesize")) {
            return new Response(Buffer.from("RIFF-test"), {
                status: 200,
                headers: { "X-Vox-Synthesis-Ms": "37" },
            });
        }
        if (url.endsWith("/shutdown")) queueMicrotask(() => child.emit("exit", 0, null));
        return new Response("{}", { status: 200 });
    };
    let spawnCalls = 0;
    let spawnArgs;
    let spawnOptions;
    const manager = createChatterboxManager({
        loadConfig: async () => ({
            referencePath: "C:\\safe\\authorized-reference.wav",
            cachePath: "C:\\safe\\cache",
            pythonPath: "C:\\safe\\python.exe",
            cpuThreads: 8,
        }),
        spawnProcess: (_python, args, options) => {
            spawnCalls += 1;
            spawnArgs = args;
            spawnOptions = options;
            queueMicrotask(() => child.stdout.write('{"event":"ready","port":54321,"modelLoadMs":125}\n'));
            return child;
        },
        fetchImpl,
        startupTimeoutMs: 1000,
        requestTimeoutMs: 1000,
    });

    const [first, second] = await Promise.all([manager.start(), manager.start()]);
    assert.equal(spawnCalls, 1);
    assert.equal(first.state, "ready");
    assert.equal(second.port, 54321);
    assert.equal(first.modelLoadMs, 125);
    assert.equal(spawnArgs.at(-2), "--parent-pid");
    assert.equal(spawnArgs.at(-1), String(process.pid));
    assert.equal(spawnOptions.stdio[0], "ignore");

    const result = await manager.synthesize({ text: "hello", requestId: "request-1" });
    assert.equal(result.audio.toString(), "RIFF-test");
    assert.equal(result.synthesisMs, 37);
    await manager.cancel("request-1");
    assert.ok(requests.some(({ url }) => url.endsWith("/cancel")));

    manager.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manager.status().state, "stopped");
    assert.ok(requests.some(({ url }) => url.endsWith("/shutdown")));
});

test("startup failure terminates the child and reports an error", async () => {
    const child = fakeProcess();
    let killed = false;
    child.kill = () => {
        killed = true;
        queueMicrotask(() => child.emit("exit", 1, null));
        return true;
    };
    const manager = createChatterboxManager({
        loadConfig: async () => ({
            referencePath: "C:\\safe\\authorized-reference.wav",
            cachePath: "C:\\safe\\cache",
            pythonPath: "C:\\safe\\python.exe",
            cpuThreads: 8,
        }),
        spawnProcess: () => {
            queueMicrotask(() => child.stdout.write('{"event":"ready","port":0}\n'));
            return child;
        },
        startupTimeoutMs: 1000,
    });

    await assert.rejects(manager.start(), /invalid port/);
    assert.equal(killed, true);
    assert.equal(manager.status().state, "error");
});
