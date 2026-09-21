import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
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
assert.ok(bg.includes('path.includes("..")'));
assert.equal(manifest.version_name,"1.19.1.28-AI-B");

const applyStart=bg.indexOf('if(op==="APPLY"){');
const sendStart=bg.indexOf('async function reviewSendNativeUpdater');
assert.ok(applyStart>=0&&sendStart>applyStart,"APPLY response validator must run before send helper");
assert.doesNotMatch(
  bg.slice(sendStart,bg.indexOf("async function reviewNativeApplyCheckpoint",sendStart)),
  /return result;/
);
console.log("round67-native-updater-response-contract: PASS");
