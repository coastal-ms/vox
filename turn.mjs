import { sse } from "./http-util.mjs";

const VOICE_PROMPT = "[Vox voice mode] You are in a real-time spoken conversation. The user is talking to you through a microphone, and your reply is read aloud by text-to-speech. Reply in 1-3 short, natural spoken sentences — no markdown, lists, headings, or code blocks.\n\nUser said: ";

// Tracks in-flight vox turns. While > 0, the passive /listen broadcaster stays
// quiet, because the vox turn already streams its reply to the browser via /turn.
// Only typed-in-CLI turns (n === 0) get broadcast to be spoken.
export const voxTurn = { n: 0 };

function textFrom(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join("");
    if (value && typeof value === "object" && typeof value.text === "string") return value.text;
    return "";
}

export function eventDelta(ev) {
    const data = ev?.data ?? ev;
    return textFrom(data?.deltaContent) || textFrom(data?.delta) || textFrom(data?.text) || textFrom(data?.content);
}

export function subscribe(session, name, handler) {
    const ret = session.on(name, handler);
    return () => {
        if (typeof ret === "function") ret();
        else if (ret && typeof ret.unsubscribe === "function") ret.unsubscribe();
        else if (ret && typeof ret.dispose === "function") ret.dispose();
        else if (typeof session.off === "function") session.off(name, handler);
        else if (typeof session.removeListener === "function") session.removeListener(name, handler);
    };
}

export function extractReply(ev) {
    return textFrom(ev?.data?.content);
}

export async function streamTurn(session, text, res) {
    const emit = sse(res);
    const said = String(text ?? "").trim();
    if (!said) {
        emit({ done: true });
        res.end();
        return;
    }

    const prompt = `${VOICE_PROMPT}${JSON.stringify(said)}`;
    const unsubs = [];
    let finished = false;
    let gotText = false;
    let deltaSeen = false;

    voxTurn.n++; // suppress the passive broadcaster while this vox turn streams

    const finish = (extra = {}) => {
        if (finished) return;
        finished = true;
        voxTurn.n = Math.max(0, voxTurn.n - 1);
        clearTimeout(timer);
        for (const unsub of unsubs.splice(0)) {
            try { unsub(); } catch {}
        }
        emit({ done: true, ...extra });
        try { res.end(); } catch {}
    };

    const timer = setTimeout(() => {
        finish(gotText ? {} : { error: "timeout" });
    }, 180_000);

    res.on("close", () => finish());

    unsubs.push(
        subscribe(session, "assistant.turn_start", () => {
            deltaSeen = false;
        }),
        subscribe(session, "assistant.message_start", () => {
            deltaSeen = false;
        }),
        subscribe(session, "assistant.message_delta", (ev) => {
            const delta = eventDelta(ev);
            if (!delta) return;
            gotText = true;
            deltaSeen = true;
            emit({ delta });
        }),
        subscribe(session, "assistant.message", (ev) => {
            if (!deltaSeen) {
                const delta = extractReply(ev);
                if (delta) {
                    gotText = true;
                    emit({ delta });
                }
            }
            deltaSeen = false;
        }),
        subscribe(session, "session.error", (ev) => {
            const message = ev?.error?.message || ev?.message || String(ev ?? "session error");
            finish({ error: message });
        }),
    );

    try {
        await session.sendAndWait({ prompt });
        finish();
    } catch (err) {
        finish({ error: err?.message || String(err) });
    }
}
