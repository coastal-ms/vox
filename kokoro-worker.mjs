const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const RUNTIME_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
const HF_ORIGIN = "https://huggingface.co";
const HF_PREFIX = "/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/";

const nativeFetch = self.fetch.bind(self);
self.fetch = function (input, init) {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    if (raw) {
        try {
            const remote = new URL(raw, self.location.href);
            if (remote.origin === HF_ORIGIN && remote.pathname.startsWith(HF_PREFIX)) {
                const assetPath = decodeURIComponent(remote.pathname.slice(HF_PREFIX.length));
                return nativeFetch(`/kokoro-cache?path=${encodeURIComponent(assetPath)}`, init);
            }
        } catch {}
    }
    return nativeFetch(input, init);
};

let activeGeneration = 0;
let pumping = false;
const queue = [];

const ttsReady = (async () => {
    try {
        const { KokoroTTS } = await import(RUNTIME_URL);
        const device = "wasm";
        const load = (target) => {
            self.postMessage({ status: "loading", device: target });
            return KokoroTTS.from_pretrained(MODEL_ID, {
                dtype: target === "webgpu" ? "fp32" : "q8",
                device: target,
                progress_callback: (progress) => {
                    self.postMessage({ status: "progress", device: target, progress });
                },
            });
        };
        const tts = await load(device);
        self.postMessage({ status: "ready", voices: tts.voices, device });
        return tts;
    } catch (error) {
        self.postMessage({ status: "error", error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
})();

async function pump() {
    if (pumping) return;
    pumping = true;
    try {
        const tts = await ttsReady;
        while (queue.length) {
            const request = queue.shift();
            if (request.generation !== activeGeneration) continue;
            try {
                const audio = await tts.generate(request.text, {
                    voice: request.voice,
                    speed: request.speed,
                });
                if (request.generation !== activeGeneration) continue;
                const samples = audio?.audio || audio?.data;
                if (!samples) throw new Error("Kokoro returned invalid audio");
                const copy = samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength
                    ? samples.buffer
                    : samples.slice().buffer;
                self.postMessage({
                    status: "complete",
                    requestId: request.requestId,
                    generation: request.generation,
                    sampleRate: Number(audio.sampling_rate || audio.sampleRate) || 24000,
                    audio: copy,
                }, [copy]);
            } catch (error) {
                self.postMessage({
                    status: "generation-error",
                    requestId: request.requestId,
                    generation: request.generation,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    } catch {
        queue.length = 0;
    } finally {
        pumping = false;
        if (queue.length) void pump();
    }
}

self.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "cancel") {
        activeGeneration = Math.max(activeGeneration, Number(data.generation) || 0);
        queue.length = 0;
        return;
    }
    if (data.type !== "generate" || !String(data.text || "").trim()) return;
    const generation = Number(data.generation) || 0;
    if (generation < activeGeneration) return;
    if (generation > activeGeneration) {
        activeGeneration = generation;
        queue.length = 0;
    }
    queue.push({
        requestId: String(data.requestId || ""),
        generation,
        text: String(data.text).trim(),
        voice: String(data.voice || "af_heart"),
        speed: Number(data.speed) || 1,
    });
    void pump();
});
