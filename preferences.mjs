import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeTtsPreferences } from "./tts-core.mjs";

export const TTS_PREFERENCES_PATH = join(homedir(), ".copilot", "vox-preferences.json");
let writeChain = Promise.resolve();

export async function readTtsPreferences(path = TTS_PREFERENCES_PATH) {
    try {
        return normalizeTtsPreferences(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
        if (error?.code === "ENOENT") return normalizeTtsPreferences();
        throw error;
    }
}

export async function writeTtsPreferences(value, path = TTS_PREFERENCES_PATH) {
    const normalized = normalizeTtsPreferences(value);
    const operation = writeChain.catch(() => {}).then(async () => {
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
            await rename(temporary, path);
            return normalized;
        } catch (error) {
            await rm(temporary, { force: true });
            throw error;
        }
    });
    writeChain = operation;
    return operation;
}
