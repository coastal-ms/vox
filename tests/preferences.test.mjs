import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readTtsPreferences, writeTtsPreferences } from "../preferences.mjs";

test("preferences persist as normalized JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vox-preferences-"));
    const path = join(dir, "nested", "preferences.json");
    try {
        const saved = await writeTtsPreferences({
            engine: "kokoro",
            browserVoice: "Microsoft David Desktop - English (United States)",
            sapiVoice: "Ava voice token",
            voice: "bm_fable",
            rate: 1.4,
            pitchSemitones: 3,
        }, path);
        assert.deepEqual(await readTtsPreferences(path), saved);
        assert.match(await readFile(path, "utf8"), /"browserVoice": "Microsoft David Desktop/);
        assert.match(await readFile(path, "utf8"), /"sapiVoice": "Ava voice token"/);
        assert.match(await readFile(path, "utf8"), /"voice": "bm_fable"/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("preferences persist Chatterbox Nano as a supported engine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vox-preferences-chatterbox-"));
    const path = join(dir, "preferences.json");
    try {
        await writeTtsPreferences({ engine: "chatterbox", rate: 1.1, pitchSemitones: 4 }, path);
        assert.deepEqual(await readTtsPreferences(path), {
            engine: "chatterbox",
            browserVoice: "",
            sapiVoice: "",
            voice: "af_heart",
            rate: 1.1,
            pitchSemitones: 4,
        });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("concurrent preference writes are serialized in call order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vox-preferences-concurrent-"));
    const path = join(dir, "preferences.json");
    try {
        const writes = [
            writeTtsPreferences({ voice: "af_sky" }, path),
            writeTtsPreferences({ voice: "bf_emma" }, path),
            writeTtsPreferences({ voice: "bm_lewis" }, path),
        ];
        await Promise.all(writes);
        assert.equal((await readTtsPreferences(path)).voice, "bm_lewis");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
