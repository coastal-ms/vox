import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { startInternal } from "../internal.mjs";

test("typed-turn listener filters commentary and speaks only final assistant output", async () => {
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
        assert.doesNotMatch(output, /internal reasoning/);
        assert.match(output, /spoken answer/);
        assert.match(output, /"done":true/);
    } finally {
        state.close();
    }
});
