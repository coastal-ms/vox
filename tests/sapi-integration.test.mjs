import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("front exposes SAPI lifecycle routes and closes the host", async () => {
    const source = await readFile(new URL("../front.mjs", import.meta.url), "utf8");
    assert.match(source, /createSapiManager\(\)/);
    assert.match(source, /url\.pathname === "\/sapi\/voices"/);
    assert.match(source, /url\.pathname === "\/sapi\/speak"/);
    assert.match(source, /url\.pathname === "\/sapi\/cancel"/);
    assert.match(source, /state\?\.sapi\?\.close\(\)/);
});

test("Windows setup installs the SAPI host while Unix setup leaves it out", async () => {
    const windowsSetup = await readFile(new URL("../setup.ps1", import.meta.url), "utf8");
    const unixSetup = await readFile(new URL("../setup.sh", import.meta.url), "utf8");
    assert.match(windowsSetup, /Copy-Item.+sapi-host\.ps1/);
    assert.doesNotMatch(unixSetup, /cp .+sapi-host\.ps1/);
    assert.match(unixSetup, /SAPI is Windows-only/);
});
