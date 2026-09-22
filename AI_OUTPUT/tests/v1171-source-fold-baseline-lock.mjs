import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..","..");

function gitBlobSha(filePath){
  const bytes=fs.readFileSync(filePath);
  const header=Buffer.from(`blob ${bytes.length}\0`);
  return crypto.createHash("sha1").update(header).update(bytes).digest("hex");
}

const expected=Object.freeze({
  "background-wrapper.js":"1b6faf09dfdc41f04010fdb4ee3d041626a2af49",
  "background.js":"3e370852a1a23e5a2682dcf565619bf8e15c5cce",
  "content.js":"50c6e087996c6e2f5fafc234b1fb3c42520d0848",
  "dashboard.html":"1da36a9e5fe3c4a0024fead17709b6329c17d613",
  "dashboard.css":"947dd70fd047441a375e40d687da54daab84bb84",
  "dashboard.js":"b6c25e03ff86b08eb81375f224dd8db8c013dba9",
  "manifest.json":"21dbce78f080171f6dceb4452494f17c672b2ae3"
});

for(const [name,sha] of Object.entries(expected)){
  assert.equal(gitBlobSha(path.join(root,name)),sha,`${name} drifted from ai-b/v1.17.1-source-fold baseline`);
}

const css=fs.readFileSync(path.join(root,"dashboard.css"),"utf8");
assert.match(
  css,
  /\[data-layout="studio"\] \.app-shell \{[\s\S]*?grid-template-columns:\s*minmax\(240px, 22vw\)\s+minmax\(0, 1fr\)\s+minmax\(280px, 24vw\);/,
  "known-good Studio layout must remain three columns"
);

const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8"));
assert.equal(manifest.background.service_worker,"background-wrapper.js");
assert.deepEqual(manifest.content_scripts[0].js,[
  "content-runtime-prelude.js",
  "content-artifact-security-prelude.js",
  "content-completion-guard.js",
  "content-response-delivery-hardening.js",
  "content.js"
]);

console.log("v1171-source-fold-baseline-lock: PASS");
