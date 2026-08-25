// Client renderer for the voice-mode canvas (voice in / voice out, no camera).
// Self-contained HTML served from the per-instance loopback server. Turns go to
// POST /turn; replies are spoken by browser SpeechSynthesis, local Kokoro, or Chatterbox Nano. Centerpiece is an
// audio-reactive orb driven by the mic level + conversation state.

export function renderHtml(instanceId) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>Vox — talk to your agent, hands-free</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #06070b;
    --panel: rgba(18, 21, 30, 0.6);
    --stroke: rgba(255, 255, 255, 0.10);
    --stroke-strong: rgba(255, 255, 255, 0.22);
    --ink: #eef1f6;
    --muted: #9aa3b2;
    --sans: "Sora", var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    --serif: "Instrument Serif", Georgia, serif;
    --accent: #8aa0b6; --accent-2: #5b6b7e;
    --level: 0; /* live mic loudness 0..1 */
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--sans); background: var(--bg); color: var(--ink);
    overflow: hidden; -webkit-font-smoothing: antialiased;
  }
  body[data-state="idle"]      { --accent:#7f93c9; --accent-2:#9fb2d8; }
  body[data-state="ready"]     { --accent:#9aa0b6; --accent-2:#5b6b7e; }
  body[data-state="listening"] { --accent:#5ce6a3; --accent-2:#22b685; }
  body[data-state="thinking"]  { --accent:#ffcf6b; --accent-2:#f0a93a; }
  body[data-state="speaking"]  { --accent:#7db5ff; --accent-2:#4f8cff; }

  #stage { position: fixed; inset: 0; display: flex; flex-direction: column; isolation: isolate; }

  /* ambient aurora */
  #aurora {
    position: absolute; inset: -30%; z-index: 0; pointer-events: none; filter: blur(70px); opacity: .62;
    background:
      radial-gradient(32% 38% at 20% 24%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%),
      radial-gradient(36% 42% at 82% 20%, color-mix(in srgb, var(--accent-2) 52%, transparent), transparent 72%),
      radial-gradient(30% 36% at 68% 78%, color-mix(in srgb, var(--accent) 40%, transparent), transparent 70%),
      radial-gradient(60% 64% at 50% 114%, color-mix(in srgb, var(--accent-2) 55%, transparent), transparent 70%);
    animation: drift 20s ease-in-out infinite alternate; transition: opacity .6s ease;
  }
  /* second slow-rotating aurora layer for depth */
  #aurora2 {
    position: absolute; inset: -40%; z-index: 0; pointer-events: none; filter: blur(90px); opacity: .4;
    background:
      conic-gradient(from 0deg at 50% 50%,
        color-mix(in srgb, var(--accent) 38%, transparent),
        transparent 25%,
        color-mix(in srgb, var(--accent-2) 40%, transparent) 50%,
        transparent 75%,
        color-mix(in srgb, var(--accent) 38%, transparent));
    animation: spin 60s linear infinite; transition: opacity .6s ease;
  }
  @keyframes drift { 0%{transform:translate3d(0,0,0) scale(1)} 100%{transform:translate3d(3%,-3%,0) scale(1.1)} }
  /* keep idle serene — dim the ambient layers until a conversation starts */
  body[data-state="idle"] #aurora  { opacity: .32; }
  body[data-state="idle"] #aurora2 { opacity: .16; }
  #grain {
    position: absolute; inset: 0; z-index: 9; pointer-events: none; opacity: .045; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  /* top bar: close + brand (left) · session (center) · actions (right) */
  #topbar { position: absolute; top: 0; left: 0; right: 0; z-index: 3; display: grid;
    grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 16px 16px; }
  .bar-left { display: flex; align-items: center; gap: 10px; justify-self: start; min-width: 0; }
  .bar-right { display: flex; align-items: center; gap: 9px; justify-self: end; min-width: 0; }
  .wordmark { display: inline-flex; align-items: center; gap: 7px; }
  .wordmark .logo { display: block; filter: drop-shadow(0 2px 7px color-mix(in srgb, var(--accent) 42%, transparent)); }
  .wordmark b { font-family: var(--serif); font-style: italic; font-weight: 400; font-size: 23px; letter-spacing: .3px; }
  #sessionWrap { justify-self: stretch; min-width: 0; display: flex; justify-content: center; }
  #sessSel {
    -webkit-appearance: none; appearance: none; cursor: pointer; color: var(--ink);
    width: 100%; max-width: 230px; min-width: 0; height: 34px; border-radius: 12px; padding: 0 32px 0 13px;
    text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
    background: var(--panel); border: 1px solid var(--stroke); backdrop-filter: blur(14px);
    font: 500 12px/1 var(--sans); letter-spacing: normal; text-transform: none; outline: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%238a90a0' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-position: calc(100% - 11px) center; background-size: 11px; background-repeat: no-repeat;
    transition: transform .12s ease, background-color .2s ease, border-color .2s ease, box-shadow .2s ease;
  }
  #sessSel:hover { background-color: rgba(40,46,60,.7); border-color: var(--stroke-strong); transform: translateY(-1px); }
  #sessSel:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent); }
  #sessSel option { background: #12141c; color: var(--ink); }
  .ghost {
    -webkit-appearance: none; cursor: pointer; color: var(--ink); position: relative;
    width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; font-size: 16px;
    background: var(--panel); border: 1px solid var(--stroke); backdrop-filter: blur(14px);
    transition: transform .12s ease, background .2s ease, border-color .2s ease;
  }
  .ghost:hover { background: rgba(40,46,60,.7); border-color: var(--stroke-strong); transform: translateY(-1px); }
  .ghost:active { transform: scale(.95); }
  .ghost.off { opacity: .45; }
  /* hover tooltips: explain what each top-bar control does (slight delay so a
     sweep across the bar doesn't flash every label) */
  .ghost[data-tip]::after {
    content: attr(data-tip); position: absolute; top: calc(100% + 9px); right: 0;
    padding: 6px 9px; border-radius: 9px; white-space: nowrap;
    font: 500 11px/1.2 var(--sans); letter-spacing: .2px; color: var(--ink);
    background: rgba(16,18,26,.97); border: 1px solid var(--stroke-strong);
    box-shadow: 0 10px 28px -10px rgba(0,0,0,.65);
    opacity: 0; transform: translateY(-4px); pointer-events: none; z-index: 6;
    transition: opacity .14s ease, transform .14s ease;
  }
  .ghost[data-tip]:hover::after { opacity: 1; transform: translateY(0); transition-delay: .35s; }
  /* send-now button: only while actively capturing your speech */
  #send { display: none; color: #fff; border-color: color-mix(in srgb, var(--accent) 60%, transparent); background: color-mix(in srgb, var(--accent) 28%, transparent); }
  body[data-state="listening"] #send { display: grid; }
  /* listen trigger: only when ready (between turns), to start a new capture */
  #trig { display: none; }
  body[data-state="ready"] #trig { display: grid; }
  /* mute + end: only once a session is live */
  #spk { display: none; }
  body:not([data-state="idle"]) #spk { display: grid; }
  /* stop: cancel the current capture (listening) or cut off the reply (thinking/speaking) */
  #stop { display: none; color: #fff; border-color: color-mix(in srgb, #ff7d7d 55%, transparent); background: color-mix(in srgb, #ff7d7d 26%, transparent); }
  body[data-state="listening"] #stop, body[data-state="thinking"] #stop, body[data-state="speaking"] #stop { display: grid; }
  /* listen-state pill: clear color-coded indicator of ready vs active capture */
  #listenState { display: none; align-items: center; gap: 7px; height: 30px; padding: 0 12px; border-radius: 999px;
    font: 600 11px/1 var(--sans); letter-spacing: .12em; text-transform: uppercase; white-space: nowrap;
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent); color: color-mix(in srgb, var(--accent) 85%, #fff);
    background: color-mix(in srgb, var(--accent) 14%, transparent); transition: all .2s ease; }
  body:not([data-state="idle"]) #listenState { display: inline-flex; }
  #listenState .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px 1px var(--accent); }
  body[data-state="listening"] #listenState .dot { animation: blink 1s ease-in-out infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.25} }

  /* center column */
  #center { position: relative; z-index: 2; flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; padding: 20px; }

  /* ---- the orb ---- */
  #orb-wrap { position: relative; width: min(58vw, 300px); aspect-ratio: 1; display: grid; place-items: center; }
  /* expanding rings while live */
  #orb-wrap::before, #orb-wrap::after {
    content: ""; position: absolute; inset: 8%; border-radius: 50%; pointer-events: none;
    border: 1.5px solid color-mix(in srgb, var(--accent) 45%, transparent); opacity: 0;
  }
  body[data-state="listening"] #orb-wrap::before { animation: ring 2.4s ease-out infinite; }
  body[data-state="listening"] #orb-wrap::after  { animation: ring 2.4s ease-out infinite 1.2s; }
  body[data-state="speaking"]  #orb-wrap::before { animation: ring 1.3s ease-out infinite; }
  @keyframes ring { 0%{opacity:.6; transform:scale(.85)} 100%{opacity:0; transform:scale(1.35)} }

  #orb {
    position: relative; z-index: 2; width: 78%; aspect-ratio: 1; border-radius: 50%;
    transform: scale(calc(1 + var(--level) * 0.18));
    transition: transform .08s linear;
    background:
      radial-gradient(60% 60% at 32% 28%, #ffffff 0%, color-mix(in srgb, var(--accent) 70%, #fff) 22%, var(--accent) 52%, var(--accent-2) 100%);
    box-shadow:
      0 30px 90px -18px color-mix(in srgb, var(--accent) 70%, transparent),
      0 0 70px 4px color-mix(in srgb, var(--accent-2) 45%, transparent),
      inset 0 2px 6px rgba(255,255,255,.55), inset 0 -20px 40px rgba(0,0,0,.25);
    animation: breathe 5s ease-in-out infinite;
  }
  @keyframes breathe { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.1)} }
  /* iridescent inner swirl — always rotating, so even idle feels alive */
  #orb::before {
    content: ""; position: absolute; inset: 4%; border-radius: 50%;
    background: conic-gradient(from 0deg,
      color-mix(in srgb, var(--accent) 70%, transparent),
      color-mix(in srgb, #ffffff 60%, transparent) 18%,
      color-mix(in srgb, var(--accent-2) 75%, transparent) 40%,
      transparent 58%,
      color-mix(in srgb, var(--accent) 65%, transparent) 78%,
      color-mix(in srgb, var(--accent-2) 70%, transparent));
    mix-blend-mode: screen; opacity: .85; filter: blur(8px);
    animation: spin 9s linear infinite;
  }
  body[data-state="thinking"] #orb::before { animation-duration: 2.4s; }
  body[data-state="speaking"] #orb { cursor: pointer; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #orb::after {
    content: ""; position: absolute; top: 12%; left: 18%; width: 34%; height: 24%; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(255,255,255,.85), transparent); filter: blur(2px);
    z-index: 2;
  }
  /* iridescent oil-slick sheen — layered hues that rotate + slowly shift hue */
  #iris {
    position: absolute; inset: 2%; border-radius: 50%; z-index: 1; pointer-events: none;
    mix-blend-mode: screen; opacity: .9;
    background:
      conic-gradient(from 0deg,
        #ff5fae 0deg, #ffd36e 60deg, #6effc4 120deg,
        #6ec3ff 190deg, #b07cff 250deg, #ff7ad9 310deg, #ff5fae 360deg),
      radial-gradient(40% 40% at 30% 26%, rgba(255,255,255,.9), transparent 60%);
    background-blend-mode: screen;
    filter: blur(6px) saturate(140%);
    -webkit-mask: radial-gradient(circle at 50% 50%, #000 52%, transparent 74%);
            mask: radial-gradient(circle at 50% 50%, #000 52%, transparent 74%);
    animation: irisSpin 14s linear infinite, irisHue 9s linear infinite;
  }
  @keyframes irisSpin { to { transform: rotate(360deg); } }
  @keyframes irisHue  { to { filter: blur(6px) saturate(140%) hue-rotate(360deg); } }
  /* full iridescence at idle; ease it back while active so state hues read */
  body[data-state="idle"]      #iris { opacity: .95; }
  body[data-state="listening"] #iris { opacity: .5; }
  body[data-state="thinking"]  #iris { opacity: .55; animation-duration: 5s, 4s; }
  body[data-state="speaking"]  #iris { opacity: .6; }
  /* the entire orb area is the single control — tap anywhere on it */
  #orb-wrap { cursor: pointer; }
  #orb { cursor: pointer; }
  #orb-glyph {
    position: absolute; inset: 0; display: grid; place-items: center; z-index: 3;
    font-size: clamp(34px, 9vw, 52px); line-height: 1; pointer-events: none;
    filter: drop-shadow(0 2px 6px rgba(0,0,0,.35));
    opacity: 0; transform: scale(.7); transition: opacity .35s ease, transform .35s ease;
  }
  /* show the mic prompt only while idle; fade to the live visuals otherwise */
  body[data-state="idle"] #orb-glyph, body[data-state="ready"] #orb-glyph { opacity: .96; transform: scale(1); animation: glyphBob 3.4s ease-in-out infinite; }
  @keyframes glyphBob { 0%,100%{transform:scale(1) translateY(0)} 50%{transform:scale(1.06) translateY(-2px)} }

  /* audio-reactive waveform ring (canvas) layered behind the orb */
  #ring { position: absolute; inset: -14%; width: 128%; height: 128%; pointer-events: none; opacity: 0; transition: opacity .4s ease; }
  body[data-state="listening"] #ring,
  body[data-state="speaking"]  #ring { opacity: 1; }

  /* floating particles drifting around the orb */
  .particle {
    position: absolute; border-radius: 50%; pointer-events: none;
    background: color-mix(in srgb, var(--accent) 80%, #fff);
    box-shadow: 0 0 8px 1px color-mix(in srgb, var(--accent) 60%, transparent);
    opacity: 0; animation: float linear infinite;
  }
  @keyframes float {
    0%   { opacity: 0; transform: translate(0,0) scale(.6); }
    15%  { opacity: .7; }
    85%  { opacity: .7; }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); }
  }
  /* idle invitation: a clear, gentle breathing pulse + double "tap me" vox */
  body[data-state="idle"] #orb-wrap::before { animation: ringSoft 3.2s ease-out infinite; }
  body[data-state="idle"] #orb-wrap::after  { animation: ringSoft 3.2s ease-out infinite 1.6s; }
  /* gentle, slowed swirl + softer glow while idle so it feels at rest */
  body[data-state="idle"] #orb {
    box-shadow:
      0 24px 70px -22px color-mix(in srgb, var(--accent) 45%, transparent),
      0 0 44px 0 color-mix(in srgb, var(--accent-2) 26%, transparent),
      inset 0 2px 6px rgba(255,255,255,.45), inset 0 -20px 40px rgba(0,0,0,.25);
    animation: idlePulse 3.6s ease-in-out infinite;
  }
  body[data-state="idle"] #orb:hover { animation-play-state: paused; transform: scale(1.05); }
  @keyframes idlePulse { 0%,100%{transform:scale(1); filter:brightness(1)} 50%{transform:scale(1.035); filter:brightness(1.08)} }
  body[data-state="idle"] #orb::before { opacity: .5; animation-duration: 16s; }
  @keyframes ringSoft { 0%{opacity:.34; transform:scale(.9)} 70%{opacity:0; transform:scale(1.2)} 100%{opacity:0} }

  #status { font-size: 14px; font-weight: 500; letter-spacing: .4px; color: var(--muted); }
  #status b { color: color-mix(in srgb, var(--accent) 75%, #fff); font-weight: 600; }
  #caption-inner {
    max-width: 560px; text-align: center; font-size: 19px; line-height: 1.5;
    min-height: 1.5em; transition: opacity .25s ease;
    font-family: var(--serif); letter-spacing: .2px;
  }
  #caption-inner:empty { display: none; }
  .you { color: color-mix(in srgb, var(--accent) 80%, #ffffff); font-style: italic; }
  .interim { opacity: .45; }

  /* live mic-level halo behind the orb — confirms we're actually hearing you */
  #levelGlow {
    position: absolute; inset: -8%; z-index: 0; border-radius: 50%; pointer-events: none;
    background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent) 60%, transparent), transparent 66%);
    opacity: calc(var(--level) * 0.85);
    transform: scale(calc(1 + var(--level) * 0.28));
    transition: opacity .09s linear, transform .09s linear;
  }
  /* silence countdown — a thin linear bar under the status, only while the
     auto-send timer is actually running (i.e. after you've started speaking) */
  #cdbar {
    width: 180px; max-width: 60vw; height: 3px; border-radius: 3px; margin-top: -14px;
    background: color-mix(in srgb, var(--accent) 16%, transparent); overflow: hidden;
    opacity: 0; transition: opacity .2s ease;
  }
  #cdbar.show { opacity: .9; }
  #cdfill {
    height: 100%; width: 100%; border-radius: 3px; transform-origin: left center; transform: scaleX(1);
    background: var(--accent); box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 70%, transparent);
  }
  /* clear interrupt / barge-in control, shown while the agent works or talks */
  #interrupt {
    -webkit-appearance: none; cursor: pointer; display: none; align-items: center; gap: 8px;
    height: 42px; padding: 0 20px; border-radius: 999px; font: 600 13px/1 var(--sans); letter-spacing: .03em;
    color: #fff; border: 1px solid color-mix(in srgb, #ff8a8a 58%, transparent);
    background: color-mix(in srgb, #ff7d7d 24%, transparent); backdrop-filter: blur(12px);
    box-shadow: 0 8px 28px -10px color-mix(in srgb, #ff7d7d 60%, transparent);
    transition: transform .12s ease, background .2s ease, border-color .2s ease;
  }
  #interrupt span { font-size: 15px; line-height: 1; }
  #interrupt:hover { background: color-mix(in srgb, #ff7d7d 34%, transparent); border-color: color-mix(in srgb, #ff8a8a 75%, transparent); transform: translateY(-1px); }
  #interrupt:active { transform: scale(.96); }
  body[data-state="thinking"] #interrupt, body[data-state="speaking"] #interrupt { display: inline-flex; }

  /* slide-in conversation transcript — sits below the toolbar so the 📜 toggle
     stays reachable, and has its own ✕ close button */
  #log {
    position: fixed; top: 64px; right: 0; bottom: 0; width: min(360px, 86vw); z-index: 4;
    background: rgba(9, 11, 17, .82); backdrop-filter: blur(18px);
    border-left: 1px solid var(--stroke); border-top: 1px solid var(--stroke);
    border-top-left-radius: 16px; display: flex; flex-direction: column;
    transform: translateX(105%); transition: transform .32s cubic-bezier(.4,0,.2,1);
  }
  #log[data-open="true"] { transform: translateX(0); }
  #logHead {
    display: flex; align-items: center; gap: 8px;
    padding: 16px 14px 12px; font: 600 12px/1 var(--sans); letter-spacing: .16em; text-transform: uppercase;
    color: var(--muted); border-bottom: 1px solid var(--stroke);
  }
  #logHead .title { flex: 1; }
  #logHead .ghost { width: 32px; height: 32px; font-size: 14px; }
  #logBody { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  #logBody::-webkit-scrollbar { width: 8px; }
  #logBody::-webkit-scrollbar-thumb { background: var(--stroke-strong); border-radius: 8px; }
  .turn { display: flex; flex-direction: column; gap: 4px; }
  .turn .who { font: 600 10px/1 var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
  .turn .msg { font-size: 14px; line-height: 1.55; word-break: break-word; white-space: pre-wrap; }
  .turn.u .msg { color: color-mix(in srgb, var(--accent) 82%, #fff); font-family: var(--serif); font-style: italic; font-size: 16.5px; }
  .turn.a .msg { color: var(--ink); }
  #logEmpty { color: var(--muted); font-size: 13px; text-align: center; margin: auto 0; }
  /* prior conversation pulled from the CLI store reads dimmer than live turns */
  .turn.hist { opacity: .62; }
  .live-sep { align-self: center; color: var(--muted); font: 600 10px/1 var(--sans); letter-spacing: .22em; text-transform: uppercase; opacity: .8; padding: 2px 0; }
  .live-sep::before, .live-sep::after { content: "·"; margin: 0 8px; opacity: .6; }

  /* persisted speech controls */
  #settings {
    position: fixed; top: 64px; left: 0; bottom: 0; width: min(340px, 88vw); z-index: 4;
    background: rgba(9, 11, 17, .9); backdrop-filter: blur(18px);
    border-right: 1px solid var(--stroke); border-top: 1px solid var(--stroke);
    border-top-right-radius: 16px; padding: 18px; overflow-y: auto;
    transform: translateX(-105%); transition: transform .32s cubic-bezier(.4,0,.2,1);
  }
  #settings[data-open="true"] { transform: translateX(0); }
  .settings-head { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .settings-head h2 { flex: 1; margin: 0; font: 600 13px/1 var(--sans); letter-spacing: .14em; text-transform: uppercase; }
  .field { display: grid; gap: 8px; margin: 0 0 18px; }
  .field label { color: var(--muted); font: 600 11px/1.2 var(--sans); letter-spacing: .08em; text-transform: uppercase; }
  .field select {
    width: 100%; height: 40px; border-radius: 10px; padding: 0 10px;
    color: var(--ink); background: #151925; border: 1px solid var(--stroke-strong);
  }
  .range-row { display: grid; grid-template-columns: 1fr 52px; align-items: center; gap: 10px; }
  .range-row input { width: 100%; accent-color: var(--accent); }
  .range-value { color: var(--ink); text-align: right; font: 500 12px/1 var(--sans); }
  .preview-voice {
    width: 100%; min-height: 40px; border-radius: 10px; padding: 0 12px;
    color: var(--ink); background: color-mix(in srgb, var(--accent) 18%, #151925);
    border: 1px solid var(--stroke-strong); font: 600 12px/1 var(--sans); cursor: pointer;
  }
  .preview-voice:hover:not(:disabled) { border-color: var(--accent); }
  .preview-voice:disabled { cursor: wait; opacity: .62; }
  .field-note { margin: -9px 0 17px; color: var(--muted); font-size: 11px; line-height: 1.5; }
  #kokoroStatus { min-height: 1.4em; color: color-mix(in srgb, var(--accent) 80%, #fff); }

  /* transient toast — confirms which chat you switched to; sits low, just above the
     bottom hint, so it appears right where your attention is when you switch */
  #toast {
    position: fixed; left: 50%; bottom: 52px; transform: translateX(-50%) translateY(12px);
    z-index: 60; max-width: 82vw; padding: 8px 16px; border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 24%, rgba(9,11,17,.92));
    border: 1px solid var(--stroke-strong); color: var(--ink);
    font: 600 13px/1.2 var(--sans); letter-spacing: .2px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; box-shadow: 0 12px 32px rgba(0,0,0,.45);
    opacity: 0; pointer-events: none; transition: opacity .25s ease, transform .25s ease;
  }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  /* permission overlay */
  #overlay { position: absolute; inset: 0; z-index: 5; display: none; place-items: center; text-align: center; padding: 28px; background: rgba(5,6,10,.7); backdrop-filter: blur(6px); }
  #overlay.show { display: grid; }
  #overlay .glyph { font-size: 30px; margin-bottom: 12px; }
  #overlay h2 { margin: 0 0 8px; font-family: var(--serif); font-style: italic; font-weight: 400; font-size: 24px; }
  #overlay p { margin: 0 auto; max-width: 360px; font-size: 13.5px; line-height: 1.55; color: var(--muted); }

  /* discreet end-session control, tucked in the corner, only while live */
  #end { display: none; }
  body:not([data-state="idle"]) #end { display: grid; }
  .hint { position: relative; z-index: 2; flex: none; font-size: 11px; color: var(--muted); text-align: center; padding: 0 16px 12px; letter-spacing: .2px; }
  /* boot: on open we briefly check mic permission — stay calm, no "tap me" flash */
  #status, #hint { transition: opacity .3s ease; }
  body.boot #status, body.boot #hint, body.boot #orb-glyph, body.boot #trig { opacity: 0 !important; }
  body.boot #orb-wrap::before, body.boot #orb-wrap::after { animation: none !important; opacity: 0 !important; }
</style>
</head>
<body data-state="idle" class="boot">
  <div id="stage">
    <div id="aurora"></div>
    <div id="aurora2"></div>
    <div id="toast" role="status" aria-live="polite"></div>

    <div id="topbar">
      <div class="bar-left">
        <span class="wordmark">
          <svg class="logo" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <defs><linearGradient id="voxlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a8b8db"/><stop offset="1" stop-color="#7f93c9"/></linearGradient></defs>
            <circle cx="12" cy="12" r="9" fill="none" stroke="url(#voxlg)" stroke-width="1.5" opacity=".5"/>
            <rect x="8.3" y="9" width="1.7" height="6" rx=".85" fill="url(#voxlg)"/>
            <rect x="11.15" y="6.4" width="1.7" height="11.2" rx=".85" fill="url(#voxlg)"/>
            <rect x="14" y="9" width="1.7" height="6" rx=".85" fill="url(#voxlg)"/>
          </svg>
          <b>vox</b>
        </span>
      </div>
      <div id="sessionWrap"><select id="sessSel" aria-label="Active chat session"><option value="">Loading…</option></select></div>
      <div class="bar-right">
        <span id="listenState"><span class="dot"></span><span id="listenLabel">Ready</span></span>
        <button id="send" class="ghost" aria-label="Send now" data-tip="Send now · Space">&#x27A4;</button>
        <button id="stop" class="ghost" aria-label="Stop" data-tip="Stop / cancel · Esc">&#x23F9;</button>
        <button id="trig" class="ghost" aria-label="Start listening" data-tip="Start listening · Space">&#x1F3A4;</button>
        <button id="settingsBtn" class="ghost" aria-label="Speech settings" data-tip="Speech settings">&#x2699;</button>
        <button id="logBtn" class="ghost" aria-label="Transcript" data-tip="Transcript log">&#x1F4DC;</button>
        <button id="spk" class="ghost" aria-label="Mute voice" data-tip="Mute voice">&#x1F50A;</button>
        <button id="end" class="ghost" aria-label="End session" data-tip="End session">&#x2715;</button>
      </div>
    </div>

    <div id="center">
      <div id="orb-wrap"><div id="levelGlow"></div><canvas id="ring"></canvas><div id="orb"><div id="iris"></div><span id="orb-glyph">&#x1F3A4;</span></div></div>
      <div id="status">Tap the orb to start</div>
      <div id="cdbar"><div id="cdfill"></div></div>
      <div id="caption-inner"></div>
      <button id="interrupt" title="Interrupt (Esc)"><span>&#x23F9;</span> Interrupt</button>
    </div>

    <div class="hint" id="hint">Tap the orb or press <b>Space</b> to talk &middot; pause to send<br><b>Esc</b> interrupts &middot; <b>&#x1F4DC;</b> opens the transcript</div>

    <div id="overlay"><div class="card">
      <div class="glyph">&#x1F399;</div>
      <h2 id="ov-title">Microphone needed</h2>
      <p id="ov-msg">Allow microphone access to start talking.</p>
    </div></div>

    <aside id="log" data-open="false">
      <div id="logHead"><span class="title">Transcript</span><button id="logClear" class="ghost" title="Clear transcript">&#x1F5D1;</button><button id="logClose" class="ghost" title="Close">&#x2715;</button></div>
      <div id="logBody"><div id="logEmpty">No turns yet.</div></div>
    </aside>

    <aside id="settings" data-open="false">
      <div class="settings-head"><h2>Speech settings</h2><button id="settingsClose" class="ghost" title="Close">&#x2715;</button></div>
      <div class="field">
        <label for="ttsEngine">Engine</label>
        <select id="ttsEngine"><option value="browser">Browser Speech</option><option value="kokoro">Kokoro (local model)</option><option value="chatterbox">Chatterbox Nano (local authorized voice)</option></select>
      </div>
      <div class="field">
        <label id="ttsVoiceLabel" for="ttsVoice">Kokoro voice</label>
        <select id="ttsVoice"></select>
      </div>
      <div id="browserVoiceField" class="field">
        <label for="browserVoice">Windows voice</label>
        <select id="browserVoice"><option value="">System default</option></select>
      </div>
      <div class="field">
        <label for="ttsRate">Speech rate</label>
        <div class="range-row"><input id="ttsRate" type="range" min="0.5" max="2" step="0.05" /><span id="ttsRateValue" class="range-value"></span></div>
      </div>
      <div class="field">
        <label id="ttsPitchLabel" for="ttsPitch">Pitch shift</label>
        <div class="range-row"><input id="ttsPitch" type="range" min="-12" max="12" step="1" /><span id="ttsPitchValue" class="range-value"></span></div>
      </div>
      <div class="field">
        <button id="previewVoice" class="preview-voice" type="button">&#x25B6; Preview selected voice</button>
      </div>
      <p id="ttsPitchNote" class="field-note">Pitch is approximate. Kokoro compensates generation speed before Web Audio pitch shifting so the selected speech rate stays nearly constant.</p>
      <p id="kokoroStatus" class="field-note" aria-live="polite"></p>
      <p id="chatterboxStatus" class="field-note" aria-live="polite"></p>
    </aside>

    <div id="grain"></div>
  </div>

<script type="module">
import {
  DEFAULT_TTS_PREFERENCES,
  KOKORO_MODEL_ID,
  KOKORO_RUNTIME_URL,
  KOKORO_SAMPLE_RATE,
  KOKORO_VOICES,
  SpeechQueue,
  groupKokoroVoices,
  kokoroPlaybackTiming,
  normalizeTtsPreferences,
  pitchRatioFromSemitones,
  speakWithFallback
} from "/tts-core.mjs";
(function () {
  "use strict";
  var INSTANCE = ${JSON.stringify(instanceId)};
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  var el = {
    body: document.body,
    orb: document.getElementById("orb"),
    ring: document.getElementById("ring"),
    orbWrap: document.getElementById("orb-wrap"),
    status: document.getElementById("status"),
    cap: document.getElementById("caption-inner"),
    overlay: document.getElementById("overlay"),
    ovTitle: document.getElementById("ov-title"),
    ovMsg: document.getElementById("ov-msg"),
    end: document.getElementById("end"),
    sessSel: document.getElementById("sessSel"),
    spk: document.getElementById("spk"),
    trig: document.getElementById("trig"),
    send: document.getElementById("send"),
    stop: document.getElementById("stop"),
    listenLabel: document.getElementById("listenLabel"),
    hint: document.getElementById("hint"),
    cdbar: document.getElementById("cdbar"),
    cdfill: document.getElementById("cdfill"),
    interrupt: document.getElementById("interrupt"),
    log: document.getElementById("log"),
    logBody: document.getElementById("logBody"),
    logEmpty: document.getElementById("logEmpty"),
    logBtn: document.getElementById("logBtn"),
    settings: document.getElementById("settings"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsClose: document.getElementById("settingsClose"),
    ttsEngine: document.getElementById("ttsEngine"),
    ttsVoiceLabel: document.getElementById("ttsVoiceLabel"),
    ttsVoice: document.getElementById("ttsVoice"),
    browserVoiceField: document.getElementById("browserVoiceField"),
    browserVoice: document.getElementById("browserVoice"),
    ttsRate: document.getElementById("ttsRate"),
    ttsRateValue: document.getElementById("ttsRateValue"),
    ttsPitch: document.getElementById("ttsPitch"),
    ttsPitchLabel: document.getElementById("ttsPitchLabel"),
    ttsPitchValue: document.getElementById("ttsPitchValue"),
    ttsPitchNote: document.getElementById("ttsPitchNote"),
    previewVoice: document.getElementById("previewVoice"),
    kokoroStatus: document.getElementById("kokoroStatus"),
    chatterboxStatus: document.getElementById("chatterboxStatus"),
    logClear: document.getElementById("logClear"),
    logClose: document.getElementById("logClose"),
    toast: document.getElementById("toast"),
  };

  var stream = null, recog = null;
  var live = false, busy = false, speakMuted = false, capturing = false, state = "idle";
  var audioCtx = null, analyser = null, levelRAF = 0;
  var pendingFinal = "", silenceTimer = 0;
  var stopToReady = false;     // set by ⏹ Stop so a cancelled turn rests at "ready"
  var autoListen = true;       // conversational: return to listening after each reply
  // Listening is manual to start: you open each turn yourself (orb / mic / Space),
  // but once a reply finishes we hand the mic back so you needn't click every time.
  // Once listening, the turn is sent after this much silence — or instantly via ➤.
  var SILENCE_MS = 2000;
  var ttsPrefs = normalizeTtsPreferences(DEFAULT_TTS_PREFERENCES);
  var preferenceTimer = 0;
  var preferenceRevision = 0;

  var LABELS = {
    idle: "Tap the orb to start",
    ready: "Tap the orb to talk",
    listening: "<b>Listening</b> — tap the orb to send",
    thinking: "<b>Thinking</b>…",
    speaking: "<b>Speaking</b> — tap the orb to stop"
  };
  var PILL = { ready: "Ready", listening: "Listening", thinking: "Working", speaking: "Speaking" };
  function setState(s, label) {
    state = s; el.body.setAttribute("data-state", s);
    el.status.innerHTML = label || LABELS[s] || "";
    if (el.listenLabel && PILL[s]) el.listenLabel.textContent = PILL[s];
    if (s === "idle" || s === "thinking" || s === "speaking") el.body.style.setProperty("--level", "0");
    if (s !== "listening") stopCountdown();
  }
  function showOverlay(title, msg) {
    if (title === null) { el.overlay.classList.remove("show"); return; }
    el.ovTitle.textContent = title; el.ovMsg.textContent = msg || ""; el.overlay.classList.add("show");
  }
  function caption(html) { el.cap.innerHTML = html || ""; }

  var lastFocusToken = 0;
  var loadedVer = null;
  function refreshSessions() {
    return fetch("/sessions").then(function (resp) {
      if (!resp.ok) throw new Error("sessions " + resp.status);
      return resp.json();
    }).then(function (data) {
      // Self-refresh after a redeploy: the front stamps each /sessions reply with the
      // boot id of the process serving it. The first value we see is "our" version;
      // if it ever changes, the extension was reloaded, so reload to get fresh JS.
      var ver = data && data.ver;
      if (ver) {
        if (loadedVer === null) loadedVer = ver;
        else if (ver !== loadedVer) { location.reload(); return; }
      }
      var active = data && data.active;
      var sessions = data && data.sessions || [];
      var current = el.sessSel.value;
      var focus = data && data.focus;
      el.sessSel.innerHTML = "";
      if (!sessions.length) {
        var empty = document.createElement("option");
        empty.value = ""; empty.textContent = "No sessions";
        el.sessSel.appendChild(empty);
        return;
      }
      for (var i = 0; i < sessions.length; i++) {
        var opt = document.createElement("option");
        var sid = sessions[i].id || "";
        var nm = sessions[i].name || "";
        var summary = sessions[i].summary || "";
        var shortId = sid.length > 8 ? sid.slice(0, 8) : sid;
        var titleText = summary || nm || sid;
        opt.value = sid;
        opt.textContent = (sessions[i].active ? "● " : "") + titleText + (shortId ? " — " + shortId : "");
        opt.title = (nm ? nm : "") + (summary ? " · " + summary : "") + (sid ? " · " + sid : "");
        opt.dataset.title = titleText;
        el.sessSel.appendChild(opt);
        if (sessions[i].active) active = sid;
      }
      // A fresh /vox from a session carries a new focus token, asking this window to
      // jump to that chat. Honor each token exactly once. A repeat /vox on the SAME
      // session also brings a new token, so we re-sync (reconnect + reload) rather than
      // ignore it. Manual dropdown picks never set a token, so they're left untouched.
      var pendingFocus = (focus && focus.token && focus.token !== lastFocusToken) ? focus : null;
      if (pendingFocus) lastFocusToken = focus.token;
      var hasFocusTarget = pendingFocus && pendingFocus.session &&
        sessions.some(function (s) { return s.id === pendingFocus.session; });
      el.sessSel.value = hasFocusTarget ? pendingFocus.session : (current || active || sessions[0].id);

      if (hasFocusTarget) {
        var ft = el.sessSel.options[el.sessSel.selectedIndex];
        var flabel = (ft && (ft.dataset.title || ft.textContent)) || pendingFocus.session;
        // Clean handoff for any state: bargeCancel cuts off an in-flight reply
        // (thinking) or live speech (speaking) and stops any capture (listening);
        // goReady settles the orb; then we wire the mic + transcript to the new chat.
        bargeCancel(); goReady();
        connectListen(); loadHistory(pendingFocus.session);
        if (current) toast((pendingFocus.session === current ? "Reconnected to " : "Switched to ") + flabel);
      }
    }).catch(function () {});
  }

  // ---- audio-reactive waveform ring around the orb ----
  var ringCtx = null, ringDpr = 1;
  function sizeRing() {
    if (!el.ring) return;
    var r = el.ring.getBoundingClientRect();
    ringDpr = Math.min(2, window.devicePixelRatio || 1);
    el.ring.width = Math.max(1, Math.round(r.width * ringDpr));
    el.ring.height = Math.max(1, Math.round(r.height * ringDpr));
    ringCtx = el.ring.getContext("2d");
  }
  function drawRing(freq) {
    if (!el.ring) return;
    if (!ringCtx) sizeRing();
    var ctx = ringCtx; if (!ctx) return;
    var W = el.ring.width, H = el.ring.height;
    ctx.clearRect(0, 0, W, H);
    if (state !== "listening" && state !== "speaking") return;
    var cx = W / 2, cy = H / 2;
    var radius = Math.min(W, H) * 0.40;
    var bars = 72;
    var accent = getComputedStyle(el.body).getPropertyValue("--accent").trim() || "#9b8cff";
    var accent2 = getComputedStyle(el.body).getPropertyValue("--accent-2").trim() || "#3ad6c5";
    var bins = freq ? freq.length : 0;
    for (var i = 0; i < bars; i++) {
      var t = i / bars;
      var idx = Math.floor(t * Math.min(bins, 160));
      var amp = freq ? freq[idx] / 255 : 0;
      amp = Math.pow(amp, 1.4);
      var len = radius * (0.10 + amp * 0.42);
      var ang = t * Math.PI * 2 - Math.PI / 2;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var x1 = cx + ca * radius, y1 = cy + sa * radius;
      var x2 = cx + ca * (radius + len), y2 = cy + sa * (radius + len);
      ctx.strokeStyle = i % 2 ? accent2 : accent;
      ctx.globalAlpha = 0.35 + amp * 0.6;
      ctx.lineWidth = Math.max(1, ringDpr * 2);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  window.addEventListener("resize", function () { ringCtx = null; });

  // ---- drifting particles around the orb (ambient life, always on) ----
  function spawnParticle() {
    if (!el.orbWrap) return;
    var p = document.createElement("div");
    p.className = "particle";
    var size = 2 + Math.random() * 4;
    p.style.width = size + "px"; p.style.height = size + "px";
    var startX = 10 + Math.random() * 80, startY = 10 + Math.random() * 80;
    p.style.left = startX + "%"; p.style.top = startY + "%";
    var dx = (Math.random() * 2 - 1) * 80, dy = -40 - Math.random() * 90;
    p.style.setProperty("--dx", dx.toFixed(0) + "px");
    p.style.setProperty("--dy", dy.toFixed(0) + "px");
    var dur = 4 + Math.random() * 4;
    p.style.animationDuration = dur + "s";
    el.orbWrap.appendChild(p);
    setTimeout(function () { p.remove(); }, dur * 1000 + 200);
  }
  setInterval(function () { if (state !== "idle") spawnParticle(); }, 900);

  // ---- mic + audio-reactive level ----
  async function startMic() {
    stopMic();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    showOverlay(null);
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      var buf = new Uint8Array(analyser.frequencyBinCount);
      var freq = new Uint8Array(analyser.frequencyBinCount);
      var loop = function () {
        if (!analyser) return;
        analyser.getByteTimeDomainData(buf);
        analyser.getByteFrequencyData(freq);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
        var rms = Math.sqrt(sum / buf.length);
        // Orb reacts to live mic loudness whenever the mic is open (ready + listening),
        // so you can see it is actually hearing you before you commit to a turn.
        var lvl = (state === "listening" || state === "ready") ? Math.min(1, rms * 3.2) : 0;
        el.body.style.setProperty("--level", lvl.toFixed(3));
        drawRing(freq);
        levelRAF = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { /* analyser optional */ }
  }
  function stopMic() {
    if (levelRAF) { cancelAnimationFrame(levelRAF); levelRAF = 0; }
    analyser = null;
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    el.body.style.setProperty("--level", "0");
  }

  // ---- transcript handler (Web Speech) ----
  // Only runs while listening; accumulates committed words and (re)arms the silence timer.
  function handleTranscript(finalText, interim) {
    if (state !== "listening") return;
    finalText = finalText || ""; interim = interim || "";
    if (finalText.trim()) pendingFinal += " " + finalText.trim();
    // Committed words render solid; the live (interim) tail renders dimmed, updating in real time.
    var solid = escapeHtml(pendingFinal.trim());
    var tail = escapeHtml(interim.trim());
    var html = "";
    if (solid) html += '<span class="you">' + solid + "</span>";
    if (tail) html += (solid ? " " : "") + '<span class="you interim">' + tail + "</span>";
    caption(html || '<span class="you interim">listening…</span>');
    armSilence();
  }

  // ---- silence auto-send timer + linear countdown bar ----
  // The bar only appears once the timer is actually running — i.e. after you've
  // started speaking — so an open mic with no speech shows no distracting countdown.
  function armSilence() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(sendCaptured, SILENCE_MS);
    startCountdown();
  }
  // Deplete the bar from full to empty over the silence window; restart on each new word.
  function startCountdown() {
    var bar = el.cdbar, fill = el.cdfill; if (!bar || !fill) return;
    bar.classList.add("show");
    fill.style.transition = "none";
    fill.style.transform = "scaleX(1)";
    void fill.getBoundingClientRect();
    fill.style.transition = "transform " + SILENCE_MS + "ms linear";
    fill.style.transform = "scaleX(0)";
  }
  function stopCountdown() {
    var bar = el.cdbar, fill = el.cdfill; if (!bar || !fill) return;
    bar.classList.remove("show");
    fill.style.transition = "none";
    fill.style.transform = "scaleX(1)";
  }

  // Send whatever has been captured so far (silence timeout or the ➤ button).
  // An empty capture simply returns to the ready state.
  function sendCaptured() {
    if (state !== "listening") return;
    clearTimeout(silenceTimer);
    var text = pendingFinal.trim(); pendingFinal = "";
    stopCapture();
    if (text) sendTurn(text); else goReady();
  }

  // ---- speech recognition (Web Speech) ----
  function buildRecognition() {
    if (!SR) return null;
    var r = new SR(); r.continuous = true; r.interimResults = true; r.lang = navigator.language || "en-US";
    r.onresult = function (ev) {
      var interim = "", finalText = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript;
      }
      handleTranscript(finalText, interim);
    };
    r.onerror = function (ev) {
      caption('<span class="you interim">⚠ ' + escapeHtml(ev.error || "error") + '</span>');
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        showOverlay("Microphone blocked", "Allow microphone access in your browser to talk."); stopLive();
      }
    };
    r.onstart = function () { if (state === "listening") caption('<span class="you interim">listening…</span>'); };
    r.onend = function () { if (live && capturing) { try { r.start(); } catch (e) {} } };
    return r;
  }
  function startCapture() {
    if (!recog) recog = buildRecognition();
    if (!recog) return false;
    capturing = true;
    try { recog.start(); }
    catch (e) { setTimeout(function () { if (capturing) { try { recog.start(); } catch (e2) {} } }, 250); }
    return true;
  }
  function stopCapture() { capturing = false; stopCountdown(); if (recog) { try { recog.stop(); } catch (e) {} } }

  // Resting state between turns: the mic stays open for the orb visuals, but nothing
  // is captured or sent until you start the next turn yourself.
  function goReady() {
    busy = false; stopCapture();
    clearTimeout(silenceTimer); pendingFinal = "";
    if (live) { setState("ready"); caption(""); } else setState("idle");
  }
  // Begin a manual listening turn (orb tap, mic button, Space, or auto after a reply).
  // We do NOT arm the silence timer yet — the countdown starts on your first word,
  // so you have all the time you need to begin speaking.
  function startListening() {
    if (!live || busy || state === "listening" || state === "thinking" || state === "speaking") return;
    pendingFinal = ""; caption("");
    if (!startCapture()) { setState("ready", "Speech recognition unavailable in this browser"); return; }
    setState("listening");
  }

  // ---- TTS queue (ordered, cancellable, with browser fallback) ----
  // Kokoro loads in the background. Until it is ready, or if it fails, each
  // sentence is spoken immediately with the browser's reliable native engine.
  var browserUtterance = null;
  var browserDriver = {
    speak: function (text, preferences, cancelled) {
      return new Promise(function (resolve, reject) {
        if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
          reject(new Error("Browser speech synthesis is unavailable"));
          return;
        }
        if (cancelled && cancelled()) { resolve(); return; }
        try {
          var u = new SpeechSynthesisUtterance(text);
          u.rate = preferences.rate;
          u.pitch = pitchRatioFromSemitones(preferences.pitchSemitones);
          if (preferences.browserVoice) {
            var voices = window.speechSynthesis.getVoices();
            for (var i = 0; i < voices.length; i++) {
              if (voices[i].voiceURI === preferences.browserVoice) { u.voice = voices[i]; break; }
            }
          }
          u.onend = function () { if (browserUtterance === u) browserUtterance = null; resolve(); };
          u.onerror = function () { if (browserUtterance === u) browserUtterance = null; resolve(); };
          browserUtterance = u;
          window.speechSynthesis.speak(u);
        } catch (error) { reject(error); }
      });
    },
    cancel: function () {
      browserUtterance = null;
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    }
  };

  var kokoroWorker = null, kokoroReady = false, kokoroLoading = null, kokoroFailure = null;
  var kokoroSource = null, ttsAudioCtx = null, kokoroRequestN = 0, kokoroGeneration = 1;
  var kokoroPending = new Map(), kokoroAudioQueue = [], kokoroPlaybackWaiters = [];
  var previewGeneration = 0;
  function updateKokoroStatus(text) { if (el.kokoroStatus) el.kokoroStatus.textContent = text || ""; }

  function settleKokoroPlayback() {
    if (kokoroSource || kokoroAudioQueue.length) return;
    for (var waiter of kokoroPlaybackWaiters.splice(0)) waiter();
  }

  function waitForKokoroPlayback() {
    if (!kokoroSource && !kokoroAudioQueue.length) return Promise.resolve();
    return new Promise(function (resolve) { kokoroPlaybackWaiters.push(resolve); });
  }

  function queueKokoroAudio(rawAudio, sampleRate, preferences, cancelled) {
    if (cancelled && cancelled()) return;
    kokoroAudioQueue.push({ rawAudio: rawAudio, sampleRate: sampleRate, preferences: preferences, cancelled: cancelled });
    void playNextKokoroAudio();
  }

  async function playNextKokoroAudio() {
    if (kokoroSource || !kokoroAudioQueue.length) { settleKokoroPlayback(); return; }
    var item = kokoroAudioQueue.shift();
    if (item.cancelled && item.cancelled()) { void playNextKokoroAudio(); return; }
    try {
      var samples = new Float32Array(item.rawAudio);
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable");
      if (!ttsAudioCtx || ttsAudioCtx.state === "closed") ttsAudioCtx = new AudioContextClass();
      if (ttsAudioCtx.state === "suspended") await ttsAudioCtx.resume();
      var timing = kokoroPlaybackTiming(item.preferences.rate, item.preferences.pitchSemitones);
      var buffer = ttsAudioCtx.createBuffer(1, samples.length, item.sampleRate || KOKORO_SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);
      var source = ttsAudioCtx.createBufferSource();
      kokoroSource = source;
      source.buffer = buffer;
      source.playbackRate.value = timing.pitchRatio;
      source.connect(ttsAudioCtx.destination);
      source.onended = function () {
        if (kokoroSource === source) kokoroSource = null;
        void playNextKokoroAudio();
      };
      source.start();
    } catch (error) {
      kokoroSource = null;
      void playNextKokoroAudio();
    }
  }

  function handleKokoroWorkerMessage(msg, readyResolve, readyReject) {
    if (!msg || !msg.status) return;
    if (msg.status === "loading") {
      updateKokoroStatus("Loading cached Kokoro model on " + (msg.device === "webgpu" ? "WebGPU" : "WASM") + "...");
      return;
    }
    if (msg.status === "progress") {
      var percent = Number(msg.progress && msg.progress.progress);
      updateKokoroStatus("Loading cached Kokoro model on " + (msg.device === "webgpu" ? "WebGPU" : "WASM") +
        (isFinite(percent) ? ": " + Math.round(percent) + "%" : "..."));
      return;
    }
    if (msg.status === "fallback") {
      updateKokoroStatus("WebGPU unavailable; loading cached WASM fallback...");
      return;
    }
    if (msg.status === "ready") {
      kokoroReady = true; kokoroFailure = null;
      populateKokoroVoices(msg.voices || KOKORO_VOICES);
      updateKokoroStatus("Kokoro ready (" + (msg.device === "webgpu" ? "WebGPU" : "WASM fallback") + ")");
      toast("Kokoro is ready on " + (msg.device === "webgpu" ? "WebGPU" : "WASM"));
      readyResolve();
      return;
    }
    if (msg.status === "error") {
      kokoroFailure = new Error(msg.error || "Kokoro worker failed");
      updateKokoroStatus("Kokoro unavailable - Browser Speech will be used.");
      readyReject(kokoroFailure);
      return;
    }
    var pending = kokoroPending.get(msg.requestId);
    if (!pending || Number(msg.generation) !== pending.generation) return;
    kokoroPending.delete(msg.requestId);
    if (msg.status === "generation-error") {
      pending.reject(new Error(msg.error || "Kokoro generation failed"));
      return;
    }
    if (msg.status === "complete") {
      queueKokoroAudio(msg.audio, Number(msg.sampleRate), pending.preferences, pending.cancelled);
      pending.resolve();
    }
  }

  function prepareKokoro(forceRetry) {
    if (forceRetry) { kokoroFailure = null; kokoroReady = false; }
    if (kokoroReady) return Promise.resolve();
    if (kokoroLoading) return kokoroLoading;
    if (kokoroFailure) return Promise.reject(kokoroFailure);
    if (kokoroWorker) { try { kokoroWorker.terminate(); } catch (e) {} }
    updateKokoroStatus("Starting Kokoro background worker...");
    kokoroLoading = new Promise(function (resolve, reject) {
      kokoroWorker = new Worker("/kokoro-worker.mjs", { type: "module", name: "vox-kokoro" });
      kokoroWorker.onmessage = function (event) { handleKokoroWorkerMessage(event.data, resolve, reject); };
      kokoroWorker.onerror = function (event) {
        kokoroFailure = new Error(event.message || "Kokoro worker failed");
        updateKokoroStatus("Kokoro unavailable - Browser Speech will be used.");
        reject(kokoroFailure);
      };
    }).finally(function () {
      kokoroLoading = null;
    });
    return kokoroLoading;
  }

  var kokoroDriver = {
    speak: async function (text, preferences, cancelled) {
      if (!kokoroReady || !kokoroWorker) {
        void prepareKokoro().catch(function () {});
        throw new Error("Kokoro is still loading");
      }
      var timing = kokoroPlaybackTiming(preferences.rate, preferences.pitchSemitones);
      var requestId = "k" + (++kokoroRequestN);
      var generation = kokoroGeneration;
      return new Promise(function (resolve, reject) {
        kokoroPending.set(requestId, {
          generation: generation,
          preferences: preferences,
          cancelled: cancelled,
          resolve: resolve,
          reject: reject
        });
        kokoroWorker.postMessage({
          type: "generate",
          requestId: requestId,
          generation: generation,
          text: text,
          voice: preferences.voice,
          speed: timing.generationSpeed
        });
      });
    },
    cancel: function () {
      kokoroGeneration++;
      if (kokoroWorker) {
        try { kokoroWorker.postMessage({ type: "cancel", generation: kokoroGeneration }); } catch (e) {}
      }
      kokoroPending.forEach(function (pending) { pending.resolve(); });
      kokoroPending.clear();
      kokoroAudioQueue.length = 0;
      if (kokoroSource) {
        try { kokoroSource.stop(); } catch (e) {}
        kokoroSource = null;
      }
      settleKokoroPlayback();
    }
  };

  var chatterboxReady = false, chatterboxLoading = null, chatterboxFailure = null;
  var chatterboxAudio = null, chatterboxController = null, chatterboxRequestId = "";
  var chatterboxFinish = null, chatterboxRequestN = 0;

  function updateChatterboxStatus(text) {
    if (el.chatterboxStatus) el.chatterboxStatus.textContent = text || "";
  }

  function renderChatterboxStatus(info) {
    info = info && typeof info === "object" ? info : {};
    chatterboxReady = info.state === "ready";
    if (info.state === "error") chatterboxFailure = new Error(info.error || "Chatterbox unavailable");
    var parts = ["Chatterbox Nano: " + (info.state || "stopped")];
    if (info.detail) parts.push(info.detail);
    if (info.referencePath) parts.push("Reference: " + info.referencePath);
    if (isFinite(Number(info.modelLoadMs))) parts.push("Model load: " + Math.round(Number(info.modelLoadMs)) + " ms");
    if (isFinite(Number(info.lastSynthesisMs))) parts.push("Last synthesis: " + Math.round(Number(info.lastSynthesisMs)) + " ms");
    if (isFinite(Number(info.lastResponseMs))) parts.push("Audio response: " + Math.round(Number(info.lastResponseMs)) + " ms");
    if (info.error) parts.push("Error: " + info.error);
    updateChatterboxStatus(parts.join(" | "));
  }

  function refreshChatterboxStatus() {
    return fetch("/chatterbox/status", { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("status " + response.status);
      return response.json();
    }).then(function (info) {
      renderChatterboxStatus(info);
      return info;
    }).catch(function (error) {
      updateChatterboxStatus("Chatterbox Nano diagnostics unavailable: " + (error.message || String(error)));
      return null;
    });
  }

  function prepareChatterbox(forceRetry) {
    if (forceRetry) { chatterboxFailure = null; chatterboxReady = false; }
    if (chatterboxReady) return Promise.resolve();
    if (chatterboxLoading) return chatterboxLoading;
    updateChatterboxStatus("Chatterbox Nano: starting | Loading CPU model and authorized local reference...");
    chatterboxLoading = fetch("/chatterbox/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (info) {
        renderChatterboxStatus(info);
        if (!response.ok || info.state !== "ready") {
          throw new Error(info.error || "Chatterbox Nano did not become ready");
        }
        chatterboxReady = true;
        chatterboxFailure = null;
      });
    }).catch(function (error) {
      chatterboxReady = false;
      chatterboxFailure = error;
      updateChatterboxStatus("Chatterbox Nano: error | " + (error.message || String(error)));
      throw error;
    }).finally(function () {
      chatterboxLoading = null;
    });
    return chatterboxLoading;
  }

  function cancelChatterboxRequest() {
    var requestId = chatterboxRequestId;
    chatterboxRequestId = "";
    if (requestId) {
      fetch("/chatterbox/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId }),
        keepalive: true
      }).catch(function () {});
    }
    if (chatterboxController) {
      try { chatterboxController.abort(); } catch (e) {}
      chatterboxController = null;
    }
    if (chatterboxAudio) {
      try { chatterboxAudio.pause(); } catch (e) {}
      chatterboxAudio = null;
    }
    if (chatterboxFinish) {
      var finish = chatterboxFinish;
      chatterboxFinish = null;
      finish();
    }
  }

  var chatterboxDriver = {
    speak: async function (text, preferences, cancelled) {
      if (!chatterboxReady) {
        void prepareChatterbox().catch(function () {});
        throw chatterboxFailure || new Error("Chatterbox Nano is still loading");
      }
      if (cancelled && cancelled()) return;
      if (typeof Audio === "undefined") throw new Error("Browser audio playback is unavailable");
      var requestId = "c" + Date.now().toString(36) + (++chatterboxRequestN).toString(36);
      var controller = new AbortController();
      chatterboxRequestId = requestId;
      chatterboxController = controller;
      var response, audioUrl;
      try {
        response = await fetch("/chatterbox/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text, requestId: requestId }),
          signal: controller.signal
        });
        if (!response.ok) {
          var failure = await response.text();
          throw new Error(failure || "Chatterbox synthesis failed (" + response.status + ")");
        }
        if ((cancelled && cancelled()) || controller.signal.aborted) return;
        audioUrl = URL.createObjectURL(await response.blob());
      } catch (error) {
        if (chatterboxController === controller) chatterboxController = null;
        if (chatterboxRequestId === requestId) chatterboxRequestId = "";
        throw error;
      }
      var audio = new Audio(audioUrl);
      chatterboxAudio = audio;
      audio.playbackRate = preferences.rate;
      if ("preservesPitch" in audio) audio.preservesPitch = true;
      if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = true;
      await new Promise(function (resolve, reject) {
        var settled = false;
        function finish(error) {
          if (settled) return;
          settled = true;
          if (chatterboxFinish === finish) chatterboxFinish = null;
          if (chatterboxAudio === audio) chatterboxAudio = null;
          if (chatterboxController === controller) chatterboxController = null;
          if (chatterboxRequestId === requestId) chatterboxRequestId = "";
          URL.revokeObjectURL(audioUrl);
          if (error) reject(error); else resolve();
        }
        chatterboxFinish = finish;
        audio.onended = function () { finish(); };
        audio.onerror = function () { finish(new Error("Chatterbox audio playback failed")); };
        Promise.resolve(audio.play()).catch(finish);
      });
      void refreshChatterboxStatus();
    },
    cancel: cancelChatterboxRequest
  };

  var fallbackNoticeAt = 0;
  var speechQueue = new SpeechQueue(function (text, cancelled) {
    return speakWithFallback({
      engine: ttsPrefs.engine,
      chatterbox: chatterboxDriver,
      kokoro: kokoroDriver,
      browser: browserDriver,
      text: text,
      preferences: ttsPrefs,
      cancelled: cancelled,
      onFallback: function (error, from, to) {
        var now = Date.now();
        if (now - fallbackNoticeAt > 5000) {
          fallbackNoticeAt = now;
          if (from === "chatterbox") {
            toast("Chatterbox Nano unavailable; trying " + (to === "kokoro" ? "Kokoro" : "Browser Speech"));
          } else {
            toast(kokoroFailure ? "Kokoro unavailable; using Browser Speech" : "Using Browser Speech while Kokoro loads");
          }
        }
      }
    });
  });
  function enqueueSpeak(text) {
    text = (text || "").trim();
    if (!speakMuted && text) speechQueue.enqueue(text);
  }
  function stopSpeaking() {
    previewGeneration++;
    speechQueue.cancel(function () { browserDriver.cancel(); kokoroDriver.cancel(); chatterboxDriver.cancel(); });
    if (el.previewVoice) el.previewVoice.disabled = false;
  }
  function waitForSpeech() {
    return Promise.all([speechQueue.wait(), waitForKokoroPlayback()]).then(function () {});
  }

  function previewSelectedVoice() {
    stopSpeaking();
    var generation = ++previewGeneration;
    var preferences = preferencesFromControls();
    var voice = KOKORO_VOICES[preferences.voice];
    var sample = preferences.engine === "kokoro" && voice
      ? "Hi, I'm " + voice.name + "."
      : preferences.engine === "chatterbox"
        ? "Hi, this is Vox using your authorized local voice."
        : "Hi, this is Vox.";
    ttsPrefs = preferences;
    renderTtsPreferences();
    saveTtsPreferences();
    el.previewVoice.disabled = true;
    toast(preferences.engine === "kokoro"
      ? "Preparing Kokoro voice preview..."
      : preferences.engine === "chatterbox"
        ? "Preparing Chatterbox Nano preview..."
        : "Playing voice preview...");
    var cancelled = function () { return generation !== previewGeneration; };
    var playback = preferences.engine === "kokoro"
      ? Promise.all([prepareKokoro(), warmKokoroVoice(preferences.voice)]).then(function () {
          if (cancelled()) return;
        return kokoroDriver.speak(sample, preferences, cancelled).then(waitForKokoroPlayback);
        })
      : preferences.engine === "chatterbox"
        ? prepareChatterbox(true).then(function () {
            if (cancelled()) return;
            return chatterboxDriver.speak(sample, preferences, cancelled);
          })
        : browserDriver.speak(sample, preferences, cancelled);
    Promise.resolve(playback).then(function () {
      if (!cancelled()) toast("Voice preview complete");
    }).catch(function () {
      if (!cancelled()) toast("Voice preview unavailable");
    }).finally(function () {
      if (!cancelled()) el.previewVoice.disabled = false;
    });
  }

  // Pull whole sentences out of a streaming buffer; return the trailing partial.
  function findSentenceEnd(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "\\n") return i;
      if (c === "." || c === "!" || c === "?") {
        var n = s.charAt(i + 1);
        if (n === "" || n === " " || n === "\\n" || n === '"' || n === "'" || n === ")") return i;
      }
    }
    return -1;
  }
  function findLocalTtsChunkEnd(s) {
    var sentenceEnd = findSentenceEnd(s);
    if (sentenceEnd > -1 && sentenceEnd < 90) return sentenceEnd;
    if (s.length < 54) return sentenceEnd;
    var limit = Math.min(s.length - 1, 90);
    for (var i = 36; i <= limit; i++) {
      if (s.charAt(i) === "," || s.charAt(i) === ";" || s.charAt(i) === ":" || s.charAt(i) === "\u2014") return i;
    }
    for (var j = Math.min(72, limit); j >= 48; j--) {
      if (/\s/.test(s.charAt(j))) return j;
    }
    return sentenceEnd;
  }
  function flushSentences(buf) {
    var idx, guard = 0;
    while ((idx = ttsPrefs.engine === "browser" ? findSentenceEnd(buf) : findLocalTtsChunkEnd(buf)) > -1 && guard++ < 40) {
      var s = buf.slice(0, idx + 1).trim();
      if (s) enqueueSpeak(s);
      buf = buf.slice(idx + 1).replace(/^\s+/, "");
    }
    return buf;
  }

  // barge-in / interrupt: stop talking AND cut the in-flight turn short
  var activeCtrl = null;
  function bargeCancel() {
    if (activeCtrl) { try { activeCtrl.abort(); } catch (e) {} }
    stopSpeaking();
    var stoppedPassiveReply = stopListenSpeech();
    pendingFinal = ""; clearTimeout(silenceTimer); stopCountdown();
    if (stoppedPassiveReply) { goReady(); stopToReady = false; }
    return stoppedPassiveReply;
  }

  // ---- turn round-trip (streaming) ----
  async function sendTurn(text) {
    if (busy) return;
    busy = true; setState("thinking");
    caption('<span class="you">' + escapeHtml(text) + "</span>");
    logAdd("user", text);

    var ctrl = new AbortController(); activeCtrl = ctrl;
    var to = setTimeout(function () { ctrl.abort(); }, 65000);
    var full = "", pending = "", firstChunk = true, errored = "";
    try {
      var resp = await fetch("/turn", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text, session: el.sessSel.value }), signal: ctrl.signal,
      });
      var ct = resp.headers.get("content-type") || "";
      if (!resp.ok || ct.indexOf("text/event-stream") < 0) {
        var data = await resp.json().catch(function () { return null; });
        full = (data && (data.reply || data.error)) || "I didn't get a reply that time \u2014 give it another try.";
        caption("<span>" + escapeHtml(full) + "</span>"); setState("speaking"); enqueueSpeak(full);
      } else {
        var reader = resp.body.getReader(), dec = new TextDecoder(), sseBuf = "";
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          sseBuf += dec.decode(chunk.value, { stream: true });
          var frames = sseBuf.split("\\n\\n"); sseBuf = frames.pop();
          for (var f = 0; f < frames.length; f++) {
            var line = frames[f]; var p = line.indexOf("data:");
            if (p < 0) continue;
            var msg; try { msg = JSON.parse(line.slice(p + 5).trim()); } catch (e) { continue; }
            if (msg.delta) {
              if (firstChunk) { firstChunk = false; setState("speaking"); }
              full += msg.delta; pending += msg.delta;
              caption("<span>" + escapeHtml(full) + "</span>");
              pending = flushSentences(pending);
            }
            if (msg.error) errored = msg.error;
            if (msg.done) { if (pending.trim()) { enqueueSpeak(pending.trim()); pending = ""; } }
          }
        }
        if (pending.trim()) { enqueueSpeak(pending.trim()); pending = ""; }
        if (!full && errored) { full = "Sorry, something went wrong."; setState("speaking"); enqueueSpeak(full); }
      }
      await waitForSpeech();
    } catch (e) {
      if (!(e && e.name === "AbortError")) {
        var m = "I can't reach this chat right now \u2014 it may have ended. Try starting Vox again.";
        caption("<span>" + escapeHtml(m) + "</span>"); setState("speaking"); enqueueSpeak(m);
        await waitForSpeech();
      }
    } finally {
      clearTimeout(to); activeCtrl = null;
      if (full && full.trim()) logAdd("assistant", full);
      busy = false;
      goReady();
      // Hand the mic back automatically so you don't click to talk every turn.
      // ⏹ Stop sets stopToReady to keep the mic off and rest at "ready" instead.
      if (live && autoListen && !stopToReady) {
        setTimeout(function () { if (live && !busy && state === "ready") startListening(); }, 320);
      }
      stopToReady = false;
    }
  }

  // ---- lifecycle ----
  async function startLive() {
    if (live) return;
    live = true; setState("ready", "Starting…");
    try { await startMic(); }              // open mic for the orb + permission prompt
    catch (e) {
      live = false; setState("idle");
      showOverlay("Microphone blocked",
        "Couldn't access the microphone (" + (e && e.name || "error") + "). Allow access, then tap the orb again.");
      return;
    }
    if (!SR) {
      live = false; stopMic();
      setState("idle", "Voice not supported");
      el.hint.textContent = "Speech recognition isn't available here — open Vox in Chrome or Edge.";
      return;
    }
    recog = buildRecognition();
    setState("ready");
  }
  function stopLive() {
    live = false; busy = false; capturing = false;
    if (recog) { try { recog.onend = null; recog.stop(); } catch (e) {} recog = null; }
    bargeCancel();
    stopMic(); setState("idle"); caption("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- conversation transcript log ----
  function logAdd(role, text, hist) {
    text = (text || "").trim(); if (!text || !el.logBody) return;
    var t = document.createElement("div");
    t.className = "turn " + (role === "user" ? "u" : "a") + (hist ? " hist" : "");
    var w = document.createElement("div"); w.className = "who";
    w.textContent = role === "user" ? "You" : "Vox";
    var m = document.createElement("div"); m.className = "msg"; m.textContent = text;
    t.appendChild(w); t.appendChild(m);
    el.logBody.appendChild(t);
    el.logBody.scrollTop = el.logBody.scrollHeight;
    if (el.logEmpty) el.logEmpty.style.display = "none";
  }

  // Brief centered confirmation (e.g. when you switch which chat you're talking to).
  var toastTimer = null;
  function toast(msg) {
    if (!el.toast || !msg) return;
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove("show"); }, 2400);
  }

  function populateKokoroVoices(catalog) {
    catalog = catalog && typeof catalog === "object" ? catalog : KOKORO_VOICES;
    var selected = ttsPrefs.voice;
    el.ttsVoice.innerHTML = "";
    var groups = groupKokoroVoices(catalog);
    for (var g = 0; g < groups.length; g++) {
      var optgroup = document.createElement("optgroup");
      optgroup.label = groups[g].label;
      for (var v = 0; v < groups[g].voices.length; v++) {
        var voice = groups[g].voices[v];
        var option = document.createElement("option");
        option.value = voice.id;
        option.textContent = voice.name + " (" + voice.id + ")" + (voice.grade ? " - " + voice.grade : "");
        optgroup.appendChild(option);
      }
      el.ttsVoice.appendChild(optgroup);
    }
    if (Object.prototype.hasOwnProperty.call(catalog, selected)) el.ttsVoice.value = selected;
    else {
      ttsPrefs = normalizeTtsPreferences({ ...ttsPrefs, voice: DEFAULT_TTS_PREFERENCES.voice }, catalog);
      el.ttsVoice.value = ttsPrefs.voice;
    }
  }

  function populateBrowserVoices() {
    if (!window.speechSynthesis || !el.browserVoice) return;
    var selected = ttsPrefs.browserVoice;
    var voices = window.speechSynthesis.getVoices().slice().sort(function (a, b) {
      return (a.lang + " " + a.name).localeCompare(b.lang + " " + b.name);
    });
    el.browserVoice.innerHTML = '<option value="">System default</option>';
    for (var i = 0; i < voices.length; i++) {
      var option = document.createElement("option");
      option.value = voices[i].voiceURI;
      option.textContent = voices[i].name + " (" + voices[i].lang + ")";
      el.browserVoice.appendChild(option);
    }
    el.browserVoice.value = voices.some(function (voice) { return voice.voiceURI === selected; }) ? selected : "";
  }

  function renderTtsPreferences() {
    el.ttsEngine.value = ttsPrefs.engine;
    el.browserVoice.value = ttsPrefs.browserVoice;
    el.browserVoiceField.hidden = ttsPrefs.engine !== "browser";
    el.browserVoice.disabled = ttsPrefs.engine !== "browser";
    el.ttsVoice.value = ttsPrefs.voice;
    el.ttsVoice.disabled = ttsPrefs.engine !== "kokoro";
    el.ttsVoiceLabel.textContent = ttsPrefs.engine === "chatterbox" ? "Kokoro fallback voice" : "Kokoro voice";
    el.ttsRate.value = String(ttsPrefs.rate);
    el.ttsPitch.value = String(ttsPrefs.pitchSemitones);
    el.ttsPitch.disabled = ttsPrefs.engine === "chatterbox";
    el.ttsRateValue.textContent = ttsPrefs.rate.toFixed(2) + "x";
    el.ttsPitchValue.textContent = ttsPrefs.engine === "chatterbox"
      ? "Unavailable"
      : (ttsPrefs.pitchSemitones > 0 ? "+" : "") + ttsPrefs.pitchSemitones + " st";
    el.ttsPitchLabel.textContent = ttsPrefs.engine === "chatterbox" ? "Pitch shift (not supported)" : "Pitch shift";
    el.ttsPitchNote.textContent = ttsPrefs.engine === "chatterbox"
      ? "Chatterbox Nano does not expose pitch control. Speech rate uses pitch-preserving browser playback when supported."
      : "Pitch is approximate. Kokoro compensates generation speed before Web Audio pitch shifting so the selected speech rate stays nearly constant.";
  }

  function preferencesFromControls() {
    return normalizeTtsPreferences({
      engine: el.ttsEngine.value,
      browserVoice: el.browserVoice.value,
      voice: el.ttsVoice.value,
      rate: el.ttsRate.value,
      pitchSemitones: el.ttsPitch.value
    });
  }

  function saveTtsPreferences() {
    clearTimeout(preferenceTimer);
    var revision = preferenceRevision;
    var preferences = ttsPrefs;
    preferenceTimer = setTimeout(function () {
      fetch("/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences)
      }).then(function (response) {
        if (!response.ok) throw new Error("preferences " + response.status);
        return response.json();
      }).then(function (saved) {
        if (revision !== preferenceRevision) return;
        ttsPrefs = normalizeTtsPreferences(saved);
        renderTtsPreferences();
      }).catch(function () {
        toast("Could not save speech settings");
      });
    }, 180);
  }

  function onTtsPreferenceChanged() {
    var previousEngine = ttsPrefs.engine;
    preferenceRevision++;
    ttsPrefs = preferencesFromControls();
    renderTtsPreferences();
    saveTtsPreferences();
    if (ttsPrefs.engine === "kokoro") {
      void warmKokoroVoice(ttsPrefs.voice);
      void prepareKokoro(previousEngine !== "kokoro").catch(function () {});
    } else if (ttsPrefs.engine === "chatterbox") {
      void prepareChatterbox(previousEngine !== "chatterbox").catch(function () {});
      void warmKokoroVoice(ttsPrefs.voice);
      void prepareKokoro().catch(function () {});
    }
  }

  function warmKokoroVoice(voice) {
    if (!Object.prototype.hasOwnProperty.call(KOKORO_VOICES, voice)) return Promise.resolve();
    return fetch("/kokoro-cache?path=" + encodeURIComponent("voices/" + voice + ".bin"))
      .then(function (response) {
        if (!response.ok) throw new Error("voice cache " + response.status);
        return response.arrayBuffer();
      }).then(function () {});
  }

  function loadTtsPreferences() {
    var revision = preferenceRevision;
    populateKokoroVoices(KOKORO_VOICES);
    populateBrowserVoices();
    return fetch("/preferences").then(function (response) {
      if (!response.ok) throw new Error("preferences " + response.status);
      return response.json();
    }).then(function (saved) {
      if (revision !== preferenceRevision) return;
      ttsPrefs = normalizeTtsPreferences(saved);
      renderTtsPreferences();
      if (ttsPrefs.engine === "kokoro") void prepareKokoro().catch(function () {});
      if (ttsPrefs.engine === "chatterbox") {
        void prepareChatterbox().catch(function () {});
        void prepareKokoro().catch(function () {});
      }
    }).catch(function () {
      if (revision !== preferenceRevision) return;
      ttsPrefs = normalizeTtsPreferences();
      renderTtsPreferences();
      toast("Using default speech settings");
    });
  }

  // Backfill the transcript with the selected session's full prior conversation
  // (read from the CLI's own store), then mark where the live turns begin. Called
  // on first load and whenever you switch chats — never on the periodic poll, so
  // live turns aren't wiped.
  function loadHistory(sid) {
    if (!el.logBody) return;
    sid = sid || "";
    fetch("/history?session=" + encodeURIComponent(sid)).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      el.logBody.innerHTML = "";
      var turns = (data && data.turns) || [];
      for (var i = 0; i < turns.length; i++) logAdd(turns[i].role, turns[i].text, true);
      if (turns.length) {
        var sep = document.createElement("div");
        sep.className = "live-sep"; sep.textContent = "live";
        el.logBody.appendChild(sep);
      }
      if (el.logEmpty) {
        if (turns.length) { el.logEmpty.style.display = "none"; }
        else { el.logBody.appendChild(el.logEmpty); el.logEmpty.style.display = ""; }
      }
      el.logBody.scrollTop = el.logBody.scrollHeight;
    }).catch(function () {});
  }

  // ---- listen channel: speak assistant replies that come from TYPED CLI turns ----
  // The server pushes {delta}/{done} frames on /listen for any reply NOT initiated
  // by a vox turn, so things you type straight into Copilot are still read aloud.
  var listenES = null, listenSent = "", listenFull = "", listenActive = false, listenSuppressed = false, lastListenSession = null;
  function cleanForSpeech(s) {
    return String(s)
      .replace(/[*_#>\u0060]/g, "")
      .replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, "$1")
      .replace(/\\s+/g, " ")
      .trim();
  }
  function stopListenSpeech() {
    var stopped = listenActive;
    listenSuppressed = listenSuppressed || listenActive;
    listenSent = ""; listenFull = ""; listenActive = false;
    return stopped;
  }
  function flushListen() {
    var idx, guard = 0;
    while ((idx = ttsPrefs.engine === "browser" ? findSentenceEnd(listenSent) : findLocalTtsChunkEnd(listenSent)) > -1 && guard++ < 60) {
      var s = listenSent.slice(0, idx + 1).trim();
      if (s) { var c = cleanForSpeech(s); if (c) enqueueSpeak(c); }
      listenSent = listenSent.slice(idx + 1).replace(/^\\s+/, "");
    }
  }
  function onListenMsg(msg) {
    if (listenSuppressed) {
      if (msg.done) listenSuppressed = false;
      return;
    }
    if (busy) return;                 // a vox turn owns the UI/audio (server also suppresses)
    if (state === "listening") return; // don't trample a turn you're in the middle of speaking
    if (msg.delta) {
      if (!listenActive) { listenActive = true; listenSent = ""; listenFull = ""; setState("speaking"); caption(""); }
      listenFull += msg.delta; listenSent += msg.delta;
      caption("<span>" + escapeHtml(listenFull) + "</span>");
      flushListen();
    }
    if (msg.done) {
      if (listenSent && listenSent.trim()) { var t = cleanForSpeech(listenSent.trim()); if (t) enqueueSpeak(t); listenSent = ""; }
      if (listenActive) {
        if (listenFull.trim()) logAdd("assistant", listenFull.trim());
        listenFull = ""; listenActive = false;
        waitForSpeech().then(function () { if (!busy && state === "speaking") goReady(); });
      }
    }
  }
  function connectListen() {
    if (typeof EventSource === "undefined") return;
    try { if (listenES) listenES.close(); } catch (e) {}
    listenSuppressed = false;
    var sid = el.sessSel.value || "";
    lastListenSession = sid;
    try {
      listenES = new EventSource("/listen?session=" + encodeURIComponent(sid));
      listenES.onopen = function () { listenSuppressed = false; };
      listenES.onmessage = function (e) {
        var msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
        onListenMsg(msg);
      };
    } catch (e) {}
  }

  // If mic permission is already granted, open straight into listening on load —
  // no need to click the mic to start the first turn.
  function clearBoot() { el.body.classList.remove("boot"); }
  async function autoStart() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        var st = await navigator.permissions.query({ name: "microphone" });
        if (st && st.state === "granted") { await startLive(); if (live) startListening(); }
      }
    } catch (e) {}
    finally { clearBoot(); }
  }

  // The whole orb area is the single control: tap to start when idle, tap to
  // interrupt while the agent is speaking.
  function orbTap() {
    if (!live && state === "idle") { startLive(); return; }
    if (state === "ready") { startListening(); return; }
    if (state === "listening") { sendCaptured(); return; }
    if (state === "thinking" || state === "speaking") { if (bargeCancel()) startListening(); return; }
  }
  el.orbWrap.addEventListener("click", orbTap);
  el.end.addEventListener("click", stopLive);
  // Send now: skip the silence wait and send what's captured so far.
  el.send.addEventListener("click", function () { sendCaptured(); });
  // Stop: cancel the current capture (listening) or cut off the reply and rest at
  // "ready" (thinking/speaking) — the deliberate off-switch, so it won't auto-listen.
  el.stop.addEventListener("click", function () {
    if (state === "listening") { stopCapture(); goReady(); return; }
    stopToReady = true; bargeCancel();
  });
  // Start listening manually — no wake word, you choose when to talk.
  el.trig.addEventListener("click", function () {
    if (!live) { startLive(); return; }
    startListening();
  });
  el.sessSel.addEventListener("change", function () {
    var sid = el.sessSel.value;
    var opt = el.sessSel.options[el.sessSel.selectedIndex];
    var label = (opt && (opt.dataset.title || opt.textContent)) || sid;
    // Clean handoff: cut off any in-flight reply from the previous chat, settle the
    // orb, confirm the switch, and reload the transcript for the chat you picked.
    bargeCancel();
    goReady();
    toast("Now talking to " + label);
    fetch("/select", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: sid }),
    }).then(function () { refreshSessions(); connectListen(); loadHistory(sid); }).catch(function () {});
    // You switched the chat because you want to say something to it, so open the mic
    // right away instead of resting at "ready" and making you tap again. (No-op until
    // the session is live / mic is granted.)
    startListening();
  });
  setTimeout(clearBoot, 1600);
  loadTtsPreferences().finally(function () { autoStart(); });
  refreshSessions().then(function () { connectListen(); loadHistory(el.sessSel.value); });
  setInterval(function () {
    refreshSessions().then(function () {
      if ((el.sessSel.value || "") !== lastListenSession) connectListen();
    });
  }, 3000);
  void refreshChatterboxStatus();
  setInterval(function () {
    if (ttsPrefs.engine === "chatterbox" || chatterboxLoading) void refreshChatterboxStatus();
  }, 2500);
  el.spk.addEventListener("click", function () {
    speakMuted = !speakMuted; el.spk.classList.toggle("off", speakMuted);
    el.spk.innerHTML = speakMuted ? "&#x1F507;" : "&#x1F50A;";
    el.spk.setAttribute("data-tip", speakMuted ? "Unmute voice" : "Mute voice");
    el.spk.setAttribute("aria-label", speakMuted ? "Unmute voice" : "Mute voice");
    if (speakMuted) stopSpeaking();
  });

  // Clear interrupt / barge-in: stop the reply and cut the in-flight turn.
  el.interrupt.addEventListener("click", function () { if (bargeCancel()) startListening(); });
  // Transcript panel: toggle open/closed and clear.
  el.logBtn.addEventListener("click", function () {
    var open = el.log.getAttribute("data-open") === "true";
    el.log.setAttribute("data-open", open ? "false" : "true");
  });
  el.logClear.addEventListener("click", function () {
    el.logBody.innerHTML = "";
    if (el.logEmpty) { el.logBody.appendChild(el.logEmpty); el.logEmpty.style.display = ""; }
  });
  el.logClose.addEventListener("click", function () { el.log.setAttribute("data-open", "false"); });
  el.settingsBtn.addEventListener("click", function () {
    var open = el.settings.getAttribute("data-open") === "true";
    el.settings.setAttribute("data-open", open ? "false" : "true");
    if (!open) void refreshChatterboxStatus();
  });
  el.settingsClose.addEventListener("click", function () { el.settings.setAttribute("data-open", "false"); });
  el.ttsEngine.addEventListener("change", onTtsPreferenceChanged);
  el.browserVoice.addEventListener("change", onTtsPreferenceChanged);
  el.ttsVoice.addEventListener("change", onTtsPreferenceChanged);
  el.ttsRate.addEventListener("input", onTtsPreferenceChanged);
  el.ttsPitch.addEventListener("input", onTtsPreferenceChanged);
  el.previewVoice.addEventListener("click", previewSelectedVoice);
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", populateBrowserVoices);
    setTimeout(populateBrowserVoices, 250);
  }

  // ---- keyboard shortcuts: Space = talk / send, Esc = interrupt / stop ----
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (!live && state === "idle") { startLive(); return; }
      if (state === "ready") { startListening(); return; }
      if (state === "listening") { sendCaptured(); return; }
      if (state === "thinking" || state === "speaking") { if (bargeCancel()) startListening(); return; }
    } else if (e.key === "Escape" || e.key === "Esc") {
      if (state === "listening") { stopCapture(); goReady(); return; }
      if (state === "thinking" || state === "speaking") { if (bargeCancel()) startListening(); return; }
    }
  });

  if (!SR) el.hint.textContent = "Speech recognition isn't supported in this browser.";
  window.addEventListener("pagehide", function () {
    stopLive();
    chatterboxDriver.cancel();
    if (kokoroWorker) { try { kokoroWorker.terminate(); } catch (e) {} kokoroWorker = null; }
    if (ttsAudioCtx) { try { ttsAudioCtx.close(); } catch (e) {} ttsAudioCtx = null; }
  });
})();
</script>
</body>
</html>`;
}
