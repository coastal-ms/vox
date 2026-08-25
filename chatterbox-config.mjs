import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
    CHATTERBOX_CACHE_DIR,
    CHATTERBOX_CONFIG_FILE,
    CHATTERBOX_DIR,
    CHATTERBOX_REFERENCE_FILE,
    CHATTERBOX_VENV_PYTHON,
    CHATTERBOX_VOICES_DIR,
} from "./config.mjs";

const MAX_CONFIG_BYTES = 32 * 1024;

export class ChatterboxConfigError extends Error {
    constructor(message, code = "CHATTERBOX_CONFIG_INVALID") {
        super(message);
        this.name = "ChatterboxConfigError";
        this.code = code;
    }
}

function pathInside(candidate, parent) {
    const rel = relative(resolve(parent), resolve(candidate));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function localPath(value, fallback, parent, label) {
    const candidate = resolve(String(value || fallback));
    if (!pathInside(candidate, parent)) {
        throw new ChatterboxConfigError(`${label} must stay under ${resolve(parent)}`);
    }
    return candidate;
}

export function normalizeChatterboxConfig(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ChatterboxConfigError("Chatterbox config must be a JSON object");
    }
    if (value.version !== undefined && value.version !== 1) {
        throw new ChatterboxConfigError("Unsupported Chatterbox config version");
    }

    const referencePath = localPath(
        value.referencePath,
        CHATTERBOX_REFERENCE_FILE,
        CHATTERBOX_VOICES_DIR,
        "referencePath",
    );
    if (extname(referencePath).toLowerCase() !== ".wav") {
        throw new ChatterboxConfigError("referencePath must identify a WAV file");
    }

    const cpuThreads = Number(value.cpuThreads ?? 8);
    if (!Number.isInteger(cpuThreads) || cpuThreads < 1 || cpuThreads > 32) {
        throw new ChatterboxConfigError("cpuThreads must be an integer from 1 to 32");
    }

    return {
        version: 1,
        referencePath,
        cachePath: localPath(value.cachePath, CHATTERBOX_CACHE_DIR, CHATTERBOX_DIR, "cachePath"),
        pythonPath: localPath(value.pythonPath, CHATTERBOX_VENV_PYTHON, CHATTERBOX_DIR, "pythonPath"),
        cpuThreads,
    };
}

async function requireFile(path, label) {
    let info;
    try {
        info = await stat(path);
    } catch (error) {
        const wrapped = new ChatterboxConfigError(
            `${label} not found: ${path}`,
            "CHATTERBOX_NOT_CONFIGURED",
        );
        wrapped.cause = error;
        throw wrapped;
    }
    if (!info.isFile() || info.size === 0) {
        throw new ChatterboxConfigError(`${label} must be a non-empty file: ${path}`);
    }
}

export async function readChatterboxConfig(path = CHATTERBOX_CONFIG_FILE) {
    let raw;
    try {
        raw = await readFile(path, "utf8");
    } catch (error) {
        const wrapped = new ChatterboxConfigError(
            `Chatterbox is not installed. Run setup.ps1 -InstallChatterbox. Missing ${path}`,
            "CHATTERBOX_NOT_CONFIGURED",
        );
        wrapped.cause = error;
        throw wrapped;
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
        throw new ChatterboxConfigError("Chatterbox config is unexpectedly large");
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const wrapped = new ChatterboxConfigError(`Invalid JSON in ${path}`);
        wrapped.cause = error;
        throw wrapped;
    }

    const config = normalizeChatterboxConfig(parsed);
    await Promise.all([
        requireFile(config.referencePath, "Authorized reference"),
        requireFile(config.pythonPath, "Chatterbox Python environment"),
    ]);
    return config;
}

export const _test = { pathInside };
