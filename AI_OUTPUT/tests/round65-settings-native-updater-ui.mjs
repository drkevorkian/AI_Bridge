import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const html=fs.readFileSync(path.join(root,"runtime_review","settings.html"),"utf8");
const js=fs.readFileSync(path.join(root,"runtime_review","settings.js"),"utf8");
const css=fs.readFileSync(path.join(root,"runtime_review","settings.css"),"utf8");

assert.doesNotMatch(html,/AI Bridge never overwrites an unpacked extension automatically/);
for(const id of [
  "nativeHostStatus","releaseTrustStatus","automaticApplyStatus","verificationStatus",
  "checkpointStatus","availableSignedUpdate","secureUpdateNotice","testNativeUpdater",
  "checkSignedUpdate","prepareNativeUpdate","applyNativeUpdate","cancelNativeUpdate"
]) assert.ok(html.includes('id="'+id+'"'),"Settings updater UI missing "+id);
assert.ok(html.includes("Manual fallback")&&html.includes("Download latest ZIP"),"manual ZIP fallback must remain visually separate");

for(const type of [
  "AI_BRIDGE_UPDATE_NATIVE_PING","AI_BRIDGE_UPDATE_NATIVE_CHECK","AI_BRIDGE_UPDATE_STATUS",
  "AI_BRIDGE_UPDATE_PREPARE","AI_BRIDGE_UPDATE_NATIVE_APPLY","AI_BRIDGE_UPDATE_CANCEL"
]) assert.ok(js.includes(type),"Settings missing updater command "+type);

for(const phase of [
  "DRAINING","CHECKPOINTED","APPLIED_NOT_RELOADED","RELOADED_NOT_REBOUND",
  "READY_TO_RESUME","COMPLETE","FAILED","CANCELLED"
]) assert.ok(js.includes(phase),"Settings missing phase presentation "+phase);

assert.ok(js.includes('cp?.phase!=="CHECKPOINTED"'),"Apply button must require exact CHECKPOINTED phase");
assert.ok(js.includes('secureUpdater.hostConnected||!secureUpdater.releaseReady'),"signed controls must require host/trust readiness");
assert.ok(js.includes("targetVersion:target.version")&&js.includes("targetBuild:target.build"),"Prepare must use the signed CHECK target");
assert.ok(js.includes('type:"AI_BRIDGE_UPDATE_NATIVE_APPLY"'),"Apply must use the high-level native apply command");
assert.doesNotMatch(js,/AI_BRIDGE_UPDATE_NATIVE_APPLY[^\n]{0,250}(?:repository|branch|ref|path|extensionRoot|extension_root|publicKey|releaseKey)/i,
  "Settings must not supply updater authority/configuration fields");
assert.doesNotMatch(html,/(?:repository URL|branch\/ref|extension root|release public key|checkpoint ID).*<(?:input|textarea)/i,
  "Settings must not collect backend-owned updater authority");
assert.ok(js.includes("verification.configured===true")&&js.includes("verification.ready===true"),
  "Settings must render explicit release trust readiness");
assert.ok(js.includes("verification.algorithm")&&js.includes("verification.key_bits"),
  "Settings must render non-secret verification algorithm/key size status");
assert.ok(css.includes(".update-status-grid")&&css.includes(".update-subsection"),"Settings updater layout styles missing");

console.log("round65-settings-native-updater-ui: PASS");
