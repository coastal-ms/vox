import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createSapiManager } from "../sapi-manager.mjs";

function fakeProcess(onCommand) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.stdin.on("data", (chunk) => onCommand?.(JSON.parse(chunk.toString("utf8"))));
    child.kill = () => {
        child.killed = true;
        queueMicrotask(() => child.emit("exit", 0));
        return true;
    };
    return child;
}

test("SAPI host persists across requests and returns speech timing", async () => {
    let spawnCalls = 0;
    let spawnArgs;
    let spoken;
    const child = fakeProcess((command) => {
        spoken = command;
        queueMicrotask(() => child.stdout.write(`${JSON.stringify({
            type: "done",
            id: command.id,
            elapsedMs: 321,
        })}\n`));
    });
    const manager = createSapiManager({
        platform: "win32",
        hostFile: "C:\\vox\\sapi-host.ps1",
        spawnProcess: (_command, args) => {
            spawnCalls += 1;
            spawnArgs = args;
            queueMicrotask(() => child.stdout.write(`${JSON.stringify({
                type: "ready",
                voices: [{ id: "ava", name: "Microsoft Ava Online (Natural) - English (United States)" }],
            })}\n`));
            return child;
        },
    });

    const [first, second] = await Promise.all([manager.start(), manager.start()]);
    assert.equal(spawnCalls, 1);
    assert.deepEqual(first, second);
    assert.equal(spawnArgs.at(-2), "-File");
    assert.equal(spawnArgs.at(-1), "C:\\vox\\sapi-host.ps1");
    assert.deepEqual(await manager.voices(), first.voices);
    assert.deepEqual(await manager.speak({ text: "hello", voice: "ava", rate: 1.2 }), {
        type: "done",
        id: spoken.id,
        elapsedMs: 321,
    });
    assert.equal(spoken.type, "speak");
    assert.equal(spoken.voice, "ava");
    assert.equal(spoken.rate, 1.2);
    manager.close();
    assert.equal(child.killed, true);
});

test("cancel kills the active host and the next request starts a new one", async () => {
    const children = [];
    const manager = createSapiManager({
        platform: "win32",
        spawnProcess: () => {
            const child = fakeProcess();
            children.push(child);
            queueMicrotask(() => child.stdout.write('{"type":"ready","voices":[]}\n'));
            return child;
        },
    });

    await manager.start();
    manager.cancel();
    await manager.start();
    assert.equal(children.length, 2);
    assert.equal(children[0].killed, true);
    manager.close();
});

test("non-Windows SAPI reports unsupported without spawning", async () => {
    let spawnCalls = 0;
    const manager = createSapiManager({
        platform: "linux",
        spawnProcess: () => { spawnCalls += 1; },
    });

    assert.equal(manager.supported, false);
    assert.deepEqual(await manager.voices(), []);
    await assert.rejects(manager.speak({ text: "hello" }), /only on Windows/);
    assert.equal(spawnCalls, 0);
});

test("SAPI startup timeout terminates a host that never becomes ready", async () => {
    const child = fakeProcess();
    const manager = createSapiManager({
        platform: "win32",
        spawnProcess: () => child,
        startupTimeoutMs: 5,
    });

    await assert.rejects(manager.start(), /did not become ready/);
    assert.equal(child.killed, true);
});
