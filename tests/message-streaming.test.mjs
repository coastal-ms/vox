import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { startInternal } from "../internal.mjs";

test("typed-turn listener forwards assistant deltas without phase filtering", async () => {
    const session = new EventEmitter();
    session.id = "commentary-test";
    const state = await startInternal({ session });
    const client = new EventEmitter();
    const frames = [];
    client.writeHead = () => {};
    client.write = (value) => { frames.push(String(value)); };
    client.end = () => client.emit("close");
    state.addListenClient(client);

    try {
        session.emit("assistant.message_start", { data: { messageId: "c1", phase: "commentary" } });
        session.emit("assistant.message_delta", { data: { messageId: "c1", delta: "internal reasoning" } });
        session.emit("assistant.message", {
            data: { messageId: "c1", phase: "commentary", content: "internal reasoning" },
        });
        session.emit("assistant.message", {
            data: { messageId: "f1", phase: "final", content: "spoken answer" },
        });

        const output = frames.join("");
        assert.match(output, /internal reasoning/);
        assert.match(output, /spoken answer/);
        assert.match(output, /"done":true/);
    } finally {
        state.close();
    }
});

test("voice turns retain the upstream prompt and sendAndWait contract", async () => {
    const source = await readFile(new URL("../turn.mjs", import.meta.url), "utf8");
    assert.match(source, /Reply in 1-3 short, natural spoken sentences/);
    assert.match(source, /sendAndWait\(\{ prompt \}\)/);
    assert.doesNotMatch(source, /displayPrompt|commentaryMessages|phase === "commentary"/);
});

test("typed-turn streaming does not track commentary phases", async () => {
    const source = await readFile(new URL("../internal.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /commentaryMessages|phase === "commentary"/);
});
