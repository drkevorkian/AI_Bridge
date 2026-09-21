import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const updater=fs.readFileSync(path.join(root,"update_system","companion_updater.py"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));

for(const token of [
  "reviewValidateNativeUpdaterResponse",
  "NATIVE_UPDATE_HOST_IDENTITY_MISMATCH",
  "NATIVE_UPDATE_RELEASE_TRUST_INVALID",
  "NATIVE_UPDATE_RELEASE_TRUST_CONTRADICTORY",
  "NATIVE_UPDATE_CHECK_RESPONSE_INVALID",
  "NATIVE_UPDATE_APPLY_RESPONSE_INVALID",
  'result.reload_required!==true',
  'return reviewValidateNativeUpdaterResponse(op,result)'
]) assert.ok(bg.includes(token),"missing "+token);

assert.ok(bg.includes('algorithm!=="RSA-PKCS1-v1_5-SHA256"'));
assert.ok(bg.includes('bits<minimumBits'));
assert.ok(bg.includes('result.files.length<1||result.files.length>100'));
assert.ok(bg.includes("REVIEW_NATIVE_UPDATER_ALLOWED_FILES=new Set(["),"runtime updater file allowlist missing");
assert.ok(bg.includes("function reviewNativeUpdaterRuntimePath(value)"),"runtime updater path validator missing");
assert.ok(bg.includes('parts.some(part=>!part||part==="."||part==="..")'),"unsafe relative path segments must be rejected");
assert.ok(bg.includes('REVIEW_NATIVE_UPDATER_ALLOWED_FILES.has(path)'),"APPLY response files must stay inside the runtime allowlist");
assert.ok(bg.includes('/^[A-Za-z]:/.test(path)'),"drive-relative path syntax must be rejected");
assert.ok(bg.includes('files>REVIEW_NATIVE_UPDATER_ALLOWED_FILES.size'),"CHECK file count must be bounded by the runtime allowlist");
assert.ok(bg.includes('result.files.length>REVIEW_NATIVE_UPDATER_ALLOWED_FILES.size'),"APPLY file count must be bounded by the runtime allowlist");
const jsAllowStart=bg.indexOf("const REVIEW_NATIVE_UPDATER_ALLOWED_FILES=new Set([");
const jsAllowEnd=bg.indexOf("]);",jsAllowStart);
assert.ok(jsAllowStart>=0&&jsAllowEnd>jsAllowStart,"background updater allowlist block missing");
const jsFiles=[...bg.slice(jsAllowStart,jsAllowEnd).matchAll(/"([^"]+)"/g)].map(match=>match[1]).sort();

const pyAllowStart=updater.indexOf("ALLOWED_FILES = frozenset(");
const pyAllowEnd=updater.indexOf("MAX_FILE_BYTES",pyAllowStart);
assert.ok(pyAllowStart>=0&&pyAllowEnd>pyAllowStart,"native updater allowlist block missing");
const pyFiles=[...updater.slice(pyAllowStart,pyAllowEnd).matchAll(/"([^"]+)"/g)].map(match=>match[1]).sort();
assert.deepEqual(jsFiles,pyFiles,"background/native updater runtime allowlists must remain identical");

assert.equal(manifest.name,"AI Bridge Review");
assert.equal(manifest.version,"1.19.1");

const applyStart=bg.indexOf('if(op==="APPLY"){');
const sendStart=bg.indexOf('async function reviewSendNativeUpdater');
assert.ok(applyStart>=0&&sendStart>applyStart,"APPLY response validator must run before send helper");
assert.doesNotMatch(
  bg.slice(sendStart,bg.indexOf("async function reviewNativeApplyCheckpoint",sendStart)),
  /return result;/
);
console.log("round67-native-updater-response-contract: PASS");
