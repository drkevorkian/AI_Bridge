import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const power = fs.readFileSync(path.join(root, "power.js"), "utf8");

assert.ok(manifest.permissions.includes("power"), "manifest must request chrome.power permission");
assert.equal(manifest.background?.service_worker, "background-wrapper.js");
assert.match(wrapper, /importScripts\("background\.js",\s*"power\.js"\)/);
assert.match(power, /chrome\.power\.requestKeepAwake\("system"\)/);
assert.match(power, /chrome\.power\.releaseKeepAwake\(\)/);
assert.match(power, /sessionActive\s*&&\s*bridgeState\?\.running|bridgeState\?\.sessionActive\s*&&\s*bridgeState\?\.running/);
assert.match(power, /chrome\.storage\.onChanged\.addListener/);
assert.match(power, /syncPowerStateFromStorage\(\)/);
assert.doesNotMatch(power, /requestKeepAwake\("display"\)/);

console.log("power keep-awake regression ok");
