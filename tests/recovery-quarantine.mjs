import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");

assert.match(background, /const STATE_VERSION = 3;/);
assert.match(background, /RECOVERY_QUARANTINE_MODE = true/);
assert.match(background, /bridgeStateRecoveryV3/);
assert.match(background, /bridgeHistoryRecoveryV3/);
assert.match(background, /bridgeArtifactsRecoveryV3/);

const loadStart = background.indexOf("async function loadState() {");
const loadEnd = background.indexOf("\nasync function ", loadStart + 10);
assert.ok(loadStart >= 0 && loadEnd > loadStart);
const loadBody = background.slice(loadStart, loadEnd);

assert.match(loadBody, /if \(RECOVERY_QUARANTINE_MODE\)/);
assert.match(loadBody, /state = cloneDefaultState\(\)/);
assert.match(loadBody, /artifactStore = \{\}/);
assert.match(loadBody, /return;/);

const quarantineBlock = loadBody.slice(
  loadBody.indexOf("if (RECOVERY_QUARANTINE_MODE)"),
  loadBody.indexOf("return;") + "return;".length
);
assert.doesNotMatch(quarantineBlock, /chrome\.storage\.local\.get/);
assert.doesNotMatch(quarantineBlock, /bridgeStateV4Backup/);
assert.doesNotMatch(quarantineBlock, /bridgeState[^R]/);
assert.doesNotMatch(quarantineBlock, /bridgeHistory[^R]/);
assert.doesNotMatch(quarantineBlock, /bridgeArtifacts[^R]/);

assert.match(background, /const key = RECOVERY_QUARANTINE_MODE \? RECOVERY_STATE_KEY : "bridgeState"/);
assert.match(background, /const key = RECOVERY_QUARANTINE_MODE \? RECOVERY_HISTORY_KEY : "bridgeHistory"/);
assert.match(background, /const key = RECOVERY_QUARANTINE_MODE \? RECOVERY_ARTIFACTS_KEY : "bridgeArtifacts"/);

assert.match(bootstrap, /RECOVERY_QUARANTINE_UI = true/);
assert.match(bootstrap, /badge\.textContent = "RECOVERY-Q"/);
assert.match(bootstrap, /production state and dynamic adapters are disabled/);
assert.match(bootstrap, /if \(!RECOVERY_QUARANTINE_UI && !document\.querySelector/);

console.log("recovery-quarantine: production storage and dynamic startup isolated");
