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

const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const helperIndex = wrapper.indexOf('importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js")');
assert.ok(backgroundIndex >= 0, "background.js must load through the wrapper");
assert.ok(helperIndex > backgroundIndex, "power helper must load after the coordinator source and network hardening layers");

assert.match(power, /chrome\.power\.requestKeepAwake\("system"\)/);
assert.match(power, /chrome\.power\.releaseKeepAwake\(\)/);
assert.match(power, /sessionActive/);
assert.match(power, /bridgeState\?\.running/);
assert.match(power, /awaitingHuman/);
assert.match(power, /chrome\.storage\.onChanged\.addListener/);
assert.match(power, /syncPowerStateFromStorage\(\)/);
assert.match(power, /chrome\.alarms\?\.onAlarm/);
assert.match(power, /chrome\.runtime\?\.onStartup/);
assert.match(power, /Always re-request|Idempotent/);
assert.doesNotMatch(power, /requestKeepAwake\("display"\)/);

console.log("power keep-awake regression ok");
