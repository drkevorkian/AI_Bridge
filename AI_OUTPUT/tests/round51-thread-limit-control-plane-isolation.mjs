import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentJs = fs.readFileSync(path.join(here, "../runtime_review/content.js"), "utf8");
const backgroundJs = fs.readFileSync(path.join(here, "../runtime_review/background.js"), "utf8");

assert.ok(
  contentJs.includes('response: Object.freeze(["[data-message-author-role=\'assistant\'] .markdown","[data-message-author-role=\'assistant\']"])'),
  "ChatGPT response selectors must remain scoped to assistant-message DOM"
);

assert.ok(
  contentJs.includes('document.querySelectorAll("[role=\'alert\'],[aria-live=\'assertive\'],[aria-live=\'polite\']")'),
  "thread-limit detection must use provider alert/live regions"
);

assert.ok(
  contentJs.includes('!node.closest("[data-message-author-role]")'),
  "thread-limit detection must exclude transcript message containers"
);

assert.ok(
  contentJs.includes('if(/maximum length for this conversation|you(?:\'|’)ve reached the maximum length for this conversation/i.test(text)) return null;'),
  "generic provider-event classification must reject max-thread notices"
);

assert.ok(
  contentJs.includes('type:"AI_BRIDGE_THREAD_LIMIT"'),
  "max-thread notices must travel through the dedicated control-plane event"
);

assert.ok(
  backgroundJs.includes('async function reviewHandleThreadLimit'),
  "background must consume the dedicated thread-limit control-plane event"
);

assert.doesNotMatch(
  backgroundJs,
  /recordTranscript\([^\n]*maximum length for this conversation/i,
  "thread-limit notice must never be written into relay transcript directly"
);

assert.doesNotMatch(
  backgroundJs,
  /recordTranscript\([^\n]*Start new chat/i,
  "provider new-chat control text must never be written into relay transcript directly"
);

console.log("round51-thread-limit-control-plane-isolation: PASS");
