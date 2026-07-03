# Security

Vox runs entirely on your own machine:

- **No telemetry, no analytics, no remote logging.** Nothing about your voice,
  transcripts, or usage is sent anywhere by Vox itself.
- **Speech stays local to the browser.** Vox uses the browser's built-in
  `SpeechRecognition` / `speechSynthesis` Web Speech APIs inside a real,
  installed Chrome/Edge — the same speech engine and privacy model as using
  those APIs on any other site in that browser. Vox does not add its own
  speech backend or forward audio to a third-party service.
- **Local-only server.** `/vox` starts a small HTTP server bound to
  `localhost` for the current session only, to bridge the browser panel and
  the CLI/app. It is not exposed to the network.
- **No remote code execution.** The install scripts (`install.ps1`,
  `install.sh`) copy this repository's own files into
  `~/.copilot/extensions/vox` and register the extension with the Copilot
  CLI/app — they do not download or execute code from third parties.
- **Mic permission is scoped.** The Chrome/Edge "app mode" window runs under
  a dedicated `--user-data-dir` profile so the microphone permission you
  grant Vox is isolated from your regular browser profile.

## Reporting a vulnerability

If you find a security issue, please open a
[GitHub issue](https://github.com/aasis21/vox/issues) or contact the
maintainer directly rather than disclosing it publicly first.
