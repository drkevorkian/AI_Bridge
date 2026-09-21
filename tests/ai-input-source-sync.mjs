import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const source=path.join(root,"AI_OUTPUT","runtime_review");
const destination=path.join(root,"AI_INPUT");

const listRuntime=dir=>fs.readdirSync(dir,{withFileTypes:true})
  .filter(entry=>entry.isFile() && entry.name!=="README.md")
  .map(entry=>entry.name)
  .sort();

const expected=listRuntime(source);
const actual=listRuntime(destination);
assert.deepEqual(actual,expected,
  "AI_INPUT runtime file set drifted from AI_OUTPUT/runtime_review. Run: node scripts/sync-ai-input.mjs");

for(const name of expected){
  const a=fs.readFileSync(path.join(source,name));
  const b=fs.readFileSync(path.join(destination,name));
  assert.equal(Buffer.compare(a,b),0,
    `AI_INPUT/${name} drifted from AI_OUTPUT/runtime_review/${name}. Run: node scripts/sync-ai-input.mjs`);
}

for(const required of ["manifest.json","background.js","content.js","runtime-core.js","provider-limit-signatures.js","update-checkpoint.js"]){
  assert.ok(expected.includes(required),"Reviewed runtime is missing required file: "+required);
}

const sourceManifest=JSON.parse(fs.readFileSync(path.join(source,"manifest.json"),"utf8"));
const inputManifest=JSON.parse(fs.readFileSync(path.join(destination,"manifest.json"),"utf8"));
assert.equal(inputManifest.version_name,sourceManifest.version_name,
  "AI_INPUT build identity must come from AI_OUTPUT/runtime_review");

console.log(`ai-input-source-sync: PASS (${expected.length} files, ${inputManifest.version_name||inputManifest.version})`);
