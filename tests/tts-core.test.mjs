import assert from "node:assert/strict";
import { test } from "node:test";
import {
    DEFAULT_TTS_PREFERENCES,
    KOKORO_VOICES,
    SpeechQueue,
    groupKokoroVoices,
    kokoroPlaybackTiming,
    normalizeTtsPreferences,
    pitchRatioFromSemitones,
    speakWithFallback,
} from "../tts-core.mjs";

const OFFICIAL_SUPPORTED_IDS = [
    "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole",
    "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric",
    "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa", "bf_emma",
    "bf_isabella", "bm_george", "bm_lewis", "bf_alice", "bf_lily", "bm_daniel", "bm_fable",
].sort();

test("normalizes persisted preferences and rejects unknown catalog entries", () => {
    assert.deepEqual(normalizeTtsPreferences({
        engine: "kokoro",
        browserVoice: "Microsoft Aria Online (Natural) - English (United States)",
        voice: "bf_emma",
        rate: 9,
        pitchSemitones: -99,
    }), {
        engine: "kokoro",
        browserVoice: "Microsoft Aria Online (Natural) - English (United States)",
        voice: "bf_emma",
        rate: 2,
        pitchSemitones: -12,
    });
    assert.deepEqual(normalizeTtsPreferences({ engine: "other", voice: "missing" }), DEFAULT_TTS_PREFERENCES);
});

test("normalizes persisted Browser Speech voice identifiers", () => {
    assert.equal(normalizeTtsPreferences({ browserVoice: "voice-uri" }).browserVoice, "voice-uri");
    assert.equal(normalizeTtsPreferences({ browserVoice: 42 }).browserVoice, "");
    assert.equal(normalizeTtsPreferences({ browserVoice: "x".repeat(501) }).browserVoice.length, 500);
});

test("catalog matches every voice exposed by official kokoro-js 1.2.1", () => {
    assert.deepEqual(Object.keys(KOKORO_VOICES).sort(), OFFICIAL_SUPPORTED_IDS);
    assert.equal(groupKokoroVoices().flatMap((group) => group.voices).length, OFFICIAL_SUPPORTED_IDS.length);
});

test("pitch math uses semitone ratios and compensates generation speed", () => {
    assert.equal(pitchRatioFromSemitones(12), 2);
    assert.equal(pitchRatioFromSemitones(-12), 0.5);
    assert.deepEqual(kokoroPlaybackTiming(1.25, 12), { pitchRatio: 2, generationSpeed: 0.625 });
});

test("queue cancellation drops pending speech and ignores active completion", async () => {
    let release;
    let cancelCurrentCalls = 0;
    const spoken = [];
    const queue = new SpeechQueue(async (text, cancelled) => {
        spoken.push(text);
        await new Promise((resolve) => { release = resolve; });
        assert.equal(cancelled(), true);
    });
    queue.enqueue("first");
    queue.enqueue("second");
    await new Promise((resolve) => setImmediate(resolve));
    queue.cancel(() => { cancelCurrentCalls += 1; });
    release();
    await queue.wait();
    assert.deepEqual(spoken, ["first"]);
    assert.equal(cancelCurrentCalls, 1);
});

test("Kokoro failures fall back to browser speech", async () => {
    const calls = [];
    const result = await speakWithFallback({
        engine: "kokoro",
        kokoro: { speak: async () => { throw new Error("model loading"); } },
        browser: { speak: async (text) => { calls.push(text); return "browser"; } },
        text: "hello",
        preferences: DEFAULT_TTS_PREFERENCES,
        onFallback: (error) => calls.push(error.message),
    });
    assert.equal(result, "browser");
    assert.deepEqual(calls, ["model loading", "hello"]);
});

test("Chatterbox failures fall back through Kokoro before browser speech", async () => {
    const calls = [];
    const result = await speakWithFallback({
        engine: "chatterbox",
        chatterbox: { speak: async () => { calls.push("chatterbox"); throw new Error("sidecar unavailable"); } },
        kokoro: { speak: async () => { calls.push("kokoro"); throw new Error("model loading"); } },
        browser: { speak: async (text) => { calls.push(`browser:${text}`); return "browser"; } },
        text: "hello",
        preferences: { ...DEFAULT_TTS_PREFERENCES, engine: "chatterbox" },
        onFallback: (error, _from, next) => calls.push(`${error.message}->${next}`),
    });
    assert.equal(result, "browser");
    assert.deepEqual(calls, [
        "chatterbox",
        "sidecar unavailable->kokoro",
        "kokoro",
        "model loading->browser",
        "browser:hello",
    ]);
});

test("canceled Chatterbox speech does not continue through fallback engines", async () => {
    const calls = [];
    let canceled = false;
    await speakWithFallback({
        engine: "chatterbox",
        chatterbox: {
            speak: async () => {
                calls.push("chatterbox");
                canceled = true;
                throw new Error("aborted");
            },
        },
        kokoro: { speak: async () => calls.push("kokoro") },
        browser: { speak: async () => calls.push("browser") },
        text: "hello",
        preferences: DEFAULT_TTS_PREFERENCES,
        cancelled: () => canceled,
    });
    assert.deepEqual(calls, ["chatterbox"]);
});
