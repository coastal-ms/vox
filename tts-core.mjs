// Shared, dependency-free TTS preferences, catalog, pitch math, and queueing.

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KOKORO_RUNTIME_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
export const KOKORO_SAMPLE_RATE = 24000;

export const KOKORO_VOICES = Object.freeze({
    af_heart: { name: "Heart", language: "en-US", gender: "Female", grade: "A" },
    af_alloy: { name: "Alloy", language: "en-US", gender: "Female", grade: "C" },
    af_aoede: { name: "Aoede", language: "en-US", gender: "Female", grade: "C+" },
    af_bella: { name: "Bella", language: "en-US", gender: "Female", grade: "A-" },
    af_jessica: { name: "Jessica", language: "en-US", gender: "Female", grade: "D" },
    af_kore: { name: "Kore", language: "en-US", gender: "Female", grade: "C+" },
    af_nicole: { name: "Nicole", language: "en-US", gender: "Female", grade: "B-" },
    af_nova: { name: "Nova", language: "en-US", gender: "Female", grade: "C" },
    af_river: { name: "River", language: "en-US", gender: "Female", grade: "D" },
    af_sarah: { name: "Sarah", language: "en-US", gender: "Female", grade: "C+" },
    af_sky: { name: "Sky", language: "en-US", gender: "Female", grade: "C-" },
    am_adam: { name: "Adam", language: "en-US", gender: "Male", grade: "F+" },
    am_echo: { name: "Echo", language: "en-US", gender: "Male", grade: "D" },
    am_eric: { name: "Eric", language: "en-US", gender: "Male", grade: "D" },
    am_fenrir: { name: "Fenrir", language: "en-US", gender: "Male", grade: "C+" },
    am_liam: { name: "Liam", language: "en-US", gender: "Male", grade: "D" },
    am_michael: { name: "Michael", language: "en-US", gender: "Male", grade: "C+" },
    am_onyx: { name: "Onyx", language: "en-US", gender: "Male", grade: "D" },
    am_puck: { name: "Puck", language: "en-US", gender: "Male", grade: "C+" },
    am_santa: { name: "Santa", language: "en-US", gender: "Male", grade: "D-" },
    bf_alice: { name: "Alice", language: "en-GB", gender: "Female", grade: "D" },
    bf_emma: { name: "Emma", language: "en-GB", gender: "Female", grade: "B-" },
    bf_isabella: { name: "Isabella", language: "en-GB", gender: "Female", grade: "C" },
    bf_lily: { name: "Lily", language: "en-GB", gender: "Female", grade: "D" },
    bm_daniel: { name: "Daniel", language: "en-GB", gender: "Male", grade: "D" },
    bm_fable: { name: "Fable", language: "en-GB", gender: "Male", grade: "C" },
    bm_george: { name: "George", language: "en-GB", gender: "Male", grade: "C" },
    bm_lewis: { name: "Lewis", language: "en-GB", gender: "Male", grade: "D+" },
});

export const DEFAULT_TTS_PREFERENCES = Object.freeze({
    engine: "browser",
    browserVoice: "",
    voice: "af_heart",
    rate: 1.02,
    pitchSemitones: 0,
});

function finiteInRange(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function normalizeTtsPreferences(value, catalog = KOKORO_VOICES) {
    const input = value && typeof value === "object" ? value : {};
    return {
        engine: input.engine === "kokoro" || input.engine === "chatterbox"
            ? input.engine
            : "browser",
        browserVoice: typeof input.browserVoice === "string" ? input.browserVoice.slice(0, 500) : "",
        voice: Object.hasOwn(catalog, input.voice) ? input.voice : DEFAULT_TTS_PREFERENCES.voice,
        rate: finiteInRange(input.rate, DEFAULT_TTS_PREFERENCES.rate, 0.5, 2),
        pitchSemitones: finiteInRange(input.pitchSemitones, DEFAULT_TTS_PREFERENCES.pitchSemitones, -12, 12),
    };
}

export function pitchRatioFromSemitones(semitones) {
    return 2 ** (finiteInRange(semitones, 0, -12, 12) / 12);
}

export function kokoroPlaybackTiming(rate, pitchSemitones) {
    const normalizedRate = finiteInRange(rate, DEFAULT_TTS_PREFERENCES.rate, 0.5, 2);
    const pitchRatio = pitchRatioFromSemitones(pitchSemitones);
    return {
        pitchRatio,
        generationSpeed: normalizedRate / pitchRatio,
    };
}

export function groupKokoroVoices(catalog = KOKORO_VOICES) {
    const groups = new Map();
    for (const [id, voice] of Object.entries(catalog)) {
        const locale = String(voice.language).toLowerCase() === "en-gb" ? "British English" : "American English";
        const label = `${locale} - ${voice.gender}`;
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push({ id, ...voice });
    }
    return [...groups].map(([label, voices]) => ({
        label,
        voices: voices.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export async function speakWithFallback({
    engine,
    chatterbox,
    kokoro,
    browser,
    text,
    preferences,
    cancelled,
    onFallback,
}) {
    const candidates = engine === "chatterbox"
        ? [["chatterbox", chatterbox], ["kokoro", kokoro], ["browser", browser]]
        : engine === "kokoro"
            ? [["kokoro", kokoro], ["browser", browser]]
            : [["browser", browser]];
    let lastError;
    for (let index = 0; index < candidates.length; index++) {
        if (cancelled?.()) return;
        const [name, driver] = candidates[index];
        if (!driver || typeof driver.speak !== "function") {
            lastError = new Error(`${name} speech is unavailable`);
        } else {
            try {
                return await driver.speak(text, preferences, cancelled);
            } catch (error) {
                if (cancelled?.()) return;
                lastError = error;
            }
        }
        const next = candidates[index + 1]?.[0];
        if (next) onFallback?.(lastError, name, next);
    }
    throw lastError || new Error("No speech engine is available");
}

export class SpeechQueue {
    constructor(speak) {
        this.speak = speak;
        this.items = [];
        this.running = false;
        this.generation = 0;
        this.waiters = [];
    }

    enqueue(text) {
        const value = String(text ?? "").trim();
        if (!value) return;
        this.items.push(value);
        void this.drain();
    }

    async drain() {
        if (this.running) return;
        this.running = true;
        const generation = this.generation;
        try {
            while (this.items.length && generation === this.generation) {
                const text = this.items.shift();
                try {
                    await this.speak(text, () => generation !== this.generation);
                } catch {
                    // A failed sentence must not deadlock later queued speech.
                }
            }
        } finally {
            if (generation === this.generation) this.running = false;
            this.settle();
        }
    }

    cancel(cancelActive) {
        this.generation++;
        this.items.length = 0;
        this.running = false;
        cancelActive?.();
        this.settle();
    }

    wait() {
        if (!this.running && !this.items.length) return Promise.resolve();
        return new Promise((resolve) => this.waiters.push(resolve));
    }

    settle() {
        if (this.running || this.items.length) return;
        for (const resolve of this.waiters.splice(0)) resolve();
    }
}
