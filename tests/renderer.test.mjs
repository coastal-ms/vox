import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHtml } from "../renderer.mjs";

test("renders a parseable browser module with speech settings", () => {
    const html = renderHtml("test-session");
    const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert.ok(match, "expected inline browser module");

    const source = match[1].replace(
        /^\s*import \{[\s\S]*?\} from "\/tts-core\.mjs";\s*/,
        "",
    );
    assert.doesNotThrow(() => new Function(source));
    assert.match(html, /id="ttsEngine"/);
    assert.match(html, /id="ttsVoice"/);
    assert.match(html, /id="browserVoice"/);
    assert.match(html, /Windows voice/);
    assert.match(html, /SAPI 5 Natural \(Windows\)/);
    assert.match(html, /id="sapiVoice"/);
    assert.match(html, /id="ttsRate"/);
    assert.match(html, /id="ttsPitch"/);
    assert.match(html, /Chatterbox Nano \(local authorized voice\)/);
    assert.match(html, /id="chatterboxStatus"/);
    assert.match(html, /Last synthesis:/);
    assert.match(html, /Pitch shift \(not supported\)/);
    assert.match(html, /ttsPitch\.disabled = ttsPrefs\.engine === "chatterbox"/);
    assert.match(html, /voices\[i\]\.voiceURI === preferences\.browserVoice/);
    assert.match(html, /addEventListener\("voiceschanged", populateBrowserVoices\)/);
    assert.match(html, /populateKokoroVoices\(KOKORO_VOICES\);\s+populateBrowserVoices\(\);/);
    assert.match(html, /fetch\("\/sapi\/voices"/);
    assert.match(html, /fetch\("\/sapi\/speak"/);
    assert.match(html, /fetch\("\/sapi\/cancel"/);
    assert.match(html, /ttsPitch\.disabled = ttsPrefs\.engine === "chatterbox" \|\| ttsPrefs\.engine === "sapi"/);
});
