# Third-party notices

## Kokoro and kokoro-js

Vox can optionally load `kokoro-js` 1.2.1 from jsDelivr and the
`onnx-community/Kokoro-82M-v1.0-ONNX` model from Hugging Face at runtime. The
runtime, model, and Kokoro voice data are not bundled with Vox. Browser caches
may retain downloaded files locally.

The voice identifiers and descriptive metadata in `tts-core.mjs` are adapted
from `hexgrad/kokoro`'s `kokoro.js/src/voices.js`.

Copyright hexgrad and Kokoro contributors.

Licensed under the Apache License, Version 2.0. You may obtain a copy at
<https://www.apache.org/licenses/LICENSE-2.0>.

Source: <https://github.com/hexgrad/kokoro>

The full license text is distributed with Vox at
`LICENSES/Apache-2.0.txt`.

## Chatterbox Nano

Vox can optionally use the `chatterbox-tts` Python package and download the
`ResembleAI/chatterbox-nano` model from Hugging Face at runtime. The package,
model weights, and voice reference audio are not bundled or distributed with
Vox. They remain in the user's local Chatterbox directory.

The Windows setup resolves the package dependency graph from Microsoft's
internal Python proxy, then installs Nano-capable Chatterbox source pinned to
official upstream commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2`.

Copyright (c) 2025 Resemble AI.

Chatterbox source code and the Chatterbox Nano model are licensed under the MIT
License.

Sources:

- <https://github.com/resemble-ai/chatterbox>
- <https://huggingface.co/ResembleAI/chatterbox-nano>

Chatterbox applies Resemble AI's PerTh audio watermark to every generated
output. The watermark is intended to remain detectable after common
transformations such as MP3 compression and audio editing.

## PerTh

`chatterbox-tts` depends on Resemble AI's PerTh audio-watermarking library.
PerTh is not bundled with Vox; it is installed as part of the optional local
Python environment.

Copyright (c) 2025 Resemble AI.

PerTh is licensed under the MIT License.

Source: <https://github.com/resemble-ai/Perth>

## Voice-reference rights

Vox does not include or redistribute any voice-reference recording. Users must
supply their own local WAV and are responsible for having permission to clone
and use the represented voice. A reference file must not be added to the
project, made a default asset, or shared with other users unless its rights
explicitly allow that use.

Narakeet states that content produced with a free account is limited to
personal and evaluation use and is not licensed for commercial use. Any such
reference must remain local, must not be redistributed, and must not be used as
a project or default voice.

Narakeet usage rights:
<https://www.narakeet.com/docs/usage-rights-copyright/>
