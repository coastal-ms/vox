// Shared constants for the Vox voice extension.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const PUBLIC_PORT = 4321;
export const DIR = dirname(fileURLToPath(import.meta.url));
export const REGISTRY = join(DIR, "registry.json");
export const KOKORO_CACHE = join(homedir(), ".copilot", "vox-kokoro-cache");
export const COPILOT_DIR = join(homedir(), ".copilot");
export const CHATTERBOX_DIR = join(COPILOT_DIR, "vox-chatterbox");
export const CHATTERBOX_CONFIG_FILE = join(CHATTERBOX_DIR, "config.json");
export const CHATTERBOX_VOICES_DIR = join(CHATTERBOX_DIR, "voices");
export const CHATTERBOX_REFERENCE_FILE = join(CHATTERBOX_VOICES_DIR, "authorized-reference.wav");
export const CHATTERBOX_CACHE_DIR = join(CHATTERBOX_DIR, "cache");
export const CHATTERBOX_VENV_PYTHON = join(CHATTERBOX_DIR, ".venv", "Scripts", "python.exe");
export const CHATTERBOX_SIDECAR_FILE = join(DIR, "chatterbox-sidecar.py");
export const SAPI_HOST_FILE = join(DIR, "sapi-host.ps1");
