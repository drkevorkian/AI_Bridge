import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const companion=fs.readFileSync(path.join(root,"update_system","companion_updater.py"),"utf8");
const host=fs.readFileSync(path.join(root,"update_system","native_host.py"),"utf8");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");

for(const token of [
  "expected_version: str | None = None",
  "expected_build: str | None = None",
  'manifest.version != str(expected_version)',
  'manifest.build != str(expected_build)',
  'Signed update manifest version changed after the checkpoint was prepared.',
  'Signed update manifest build changed after the checkpoint was prepared.'
]) assert.ok(companion.includes(token),"companion target binding missing "+token);

const fetchIndex=companion.indexOf("manifest = fetch_manifest(manifest_url, signature_url)");
const versionCheck=companion.indexOf("manifest.version != str(expected_version)",fetchIndex);
const buildCheck=companion.indexOf("manifest.build != str(expected_build)",fetchIndex);
const applyIndex=companion.indexOf("AtomicUpdater(extension_root).apply(manifest)",fetchIndex);
assert.ok(fetchIndex>=0&&versionCheck>fetchIndex&&buildCheck>versionCheck&&applyIndex>buildCheck,
  "signed target version/build must be checked before any updater apply");

for(const token of [
  '"checkpointId", "expectedVersion", "expectedBuild"',
  'APPLY requires a bounded expectedVersion.',
  'APPLY requires a bounded expectedBuild.',
  'expected_version=expected_version',
  'expected_build=expected_build'
]) assert.ok(host.includes(token),"native host target binding missing "+token);

for(const token of [
  'expectedVersion:String(payload.expectedVersion||"")',
  'expectedBuild:String(payload.expectedBuild||"")',
  'NATIVE_UPDATE_TARGET_REQUIRED',
  'expectedVersion:cp.targetVersion',
  'expectedBuild:cp.targetBuild'
]) assert.ok(bg.includes(token),"background target binding missing "+token);

const handler=bg.indexOf('if (msg.type === "AI_BRIDGE_UPDATE_NATIVE_APPLY")');
assert.ok(handler>=0,"native apply handler missing");
const handlerBlock=bg.slice(handler,bg.indexOf('if (msg.type === "AI_BRIDGE_SETTINGS_OPEN")',handler));
assert.ok(handlerBlock.includes("reviewNativeApplyCheckpoint()"),"UI APPLY must use durable checkpoint target");
assert.doesNotMatch(handlerBlock,/msg\.(?:targetVersion|targetBuild|expectedVersion|expectedBuild)/,
  "UI must not supply native updater target authority");

console.log("round64-native-updater-target-binding: PASS");
