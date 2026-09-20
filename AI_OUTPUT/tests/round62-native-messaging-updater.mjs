import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));
const host=fs.readFileSync(path.join(root,"update_system","native_host.py"),"utf8");
const installer=fs.readFileSync(path.join(root,"update_system","install_native_host.py"),"utf8");

assert.ok(manifest.permissions.includes("nativeMessaging"));
assert.equal(manifest.version_name,"1.19.1.25-AI-B");
for(const token of [
  'REVIEW_NATIVE_UPDATER_HOST="com.aibridge.updater"',
  'chrome.runtime.sendNativeMessage(REVIEW_NATIVE_UPDATER_HOST,message)',
  '"AI_BRIDGE_UPDATE_NATIVE_PING"',
  '"AI_BRIDGE_UPDATE_NATIVE_CHECK"',
  '"AI_BRIDGE_UPDATE_NATIVE_APPLY"',
  'cp.phase!==UPDATE_PHASE.CHECKPOINTED',
  'NATIVE_UPDATE_CHECKPOINT_MISMATCH',
  'NATIVE_UPDATE_TARGET_MISMATCH'
]) assert.ok(bg.includes(token),"background missing "+token);
assert.doesNotMatch(bg,/sendNativeMessage\([^,]+,\s*msg\)/);

for(const token of [
  'MAX_INCOMING_BYTES = 64 * 1024',
  'MAX_OUTGOING_BYTES = 1024 * 1024',
  'struct.unpack("=I", header)',
  'struct.pack("=I", len(payload))',
  '{"PING", "CHECK", "APPLY"}',
  'Caller origin does not match configured AI Bridge extension',
  'set(message) - allowed',
  'apply_update(Path(config["extension_root"]))'
]) assert.ok(host.includes(token),"host missing "+token);
assert.doesNotMatch(host,/message\.get\("(?:url|path|repository|ref|extension_root)"\)/);

for(const token of [
  'allowed_origins',
  'chrome-extension://{extension_id}/',
  'winreg.HKEY_CURRENT_USER',
  'NativeMessagingHosts',
  'native_host.bat',
  'native-host-config.json'
]) assert.ok(installer.includes(token),"installer missing "+token);

console.log("round62-native-messaging-updater: PASS");
