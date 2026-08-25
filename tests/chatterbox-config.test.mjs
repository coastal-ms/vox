import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeChatterboxConfig } from "../chatterbox-config.mjs";
import {
    CHATTERBOX_CACHE_DIR,
    CHATTERBOX_DIR,
    CHATTERBOX_REFERENCE_FILE,
    CHATTERBOX_VENV_PYTHON,
} from "../config.mjs";

test("normalizes safe Chatterbox paths and CPU settings", () => {
    assert.deepEqual(normalizeChatterboxConfig({}), {
        version: 1,
        referencePath: CHATTERBOX_REFERENCE_FILE,
        cachePath: CHATTERBOX_CACHE_DIR,
        pythonPath: CHATTERBOX_VENV_PYTHON,
        cpuThreads: 8,
    });
});

test("rejects Chatterbox paths outside its local Copilot directory", () => {
    assert.throws(
        () => normalizeChatterboxConfig({ cachePath: join(CHATTERBOX_DIR, "..", "outside") }),
        /cachePath must stay under/,
    );
    assert.throws(
        () => normalizeChatterboxConfig({ referencePath: join(CHATTERBOX_DIR, "cache", "voice.wav") }),
        /referencePath must stay under/,
    );
});
