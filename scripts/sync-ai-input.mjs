import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const source=path.join(root,"AI_OUTPUT","runtime_review");
const destination=path.join(root,"AI_INPUT");
const preserved=new Set(["README.md"]);

if(!fs.existsSync(source)) throw new Error("Missing source runtime: "+source);
fs.mkdirSync(destination,{recursive:true});

const sourceFiles=fs.readdirSync(source,{withFileTypes:true})
  .filter(entry=>entry.isFile() && entry.name!=="README.md")
  .map(entry=>entry.name)
  .sort();
const sourceSet=new Set(sourceFiles);

for(const name of sourceFiles){
  fs.copyFileSync(path.join(source,name),path.join(destination,name));
}

for(const entry of fs.readdirSync(destination,{withFileTypes:true})){
  if(!entry.isFile() || preserved.has(entry.name)) continue;
  if(!sourceSet.has(entry.name)) fs.rmSync(path.join(destination,entry.name));
}

const manifest=JSON.parse(fs.readFileSync(path.join(destination,"manifest.json"),"utf8"));
console.log(`AI_INPUT synchronized from AI_OUTPUT/runtime_review (${sourceFiles.length} runtime files, build ${manifest.version_name||manifest.version}).`);
