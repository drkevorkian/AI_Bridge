import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const hardening = fs.readFileSync(path.join(root, "content-response-delivery-hardening.js"), "utf8");

assert.match(content, /async function monitor\(/, "content.js must include monitor()");
assert.match(content, /const responseMonitorInFlight = new Set\(\)/, "monitor must reserve in-flight response signatures before artifact capture");
assert.match(content, /responseMonitorInFlight\.add\(monitorKey\)/);
assert.match(content, /responseMonitorInFlight\.delete\(monitorKey\)/);
assert.match(content, /pendingSend = true;[\s\S]*catch \(error\) \{[\s\S]*pendingSend = false;[\s\S]*throw error;/, "failed uploads must release pendingSend immediately");
assert.match(content, /const result = await chrome\.runtime\.sendMessage\(\{[\s\S]*type:\s*"AI_BRIDGE_RESPONSE"/, "content.js must await completed response delivery");
assert.match(content, /if \(!responseDeliveryAccepted\(result\)\)[\s\S]*lastReportedText = text;[\s\S]*lastReportedSignature = signature;/, "reported state must commit only after accepted delivery");
assert.match(content, /sourceUrl: url/, "artifact identity must preserve its source URL locally");
assert.match(content, /function artifactIdentity\(/);
assert.doesNotMatch(content, /artifacts\.some\(existing => existing\.name === artifact\.name && existing\.size === artifact\.size\)/, "name+size-only artifact dedupe must stay removed");

assert.match(hardening, /const inFlight = new Map\(\)/, "delivery hardening must deduplicate in-flight response sends");
assert.match(hardening, /MAX_ATTEMPTS\s*=\s*10/, "delivery retries must have a finite budget");
assert.match(hardening, /INITIAL_RETRY_MS\s*=\s*250/);
assert.match(hardening, /extension context invalidated/i);
assert.match(hardening, /settled = new Map\(\)/);
assert.match(hardening, /supersedeOlder\(/);
assert.match(hardening, /function artifactSignature\(/, "delivery identity must include artifacts");
assert.match(hardening, /artifactSignature\(message\)/);
assert.match(hardening, /result\.ok === true/, "positive acknowledgement must be explicit");
assert.match(hardening, /result\.awaitingHuman \? "coordinator is awaiting human input"/, "human-gated negative replies must remain retryable");
assert.doesNotMatch(hardening, /return Boolean\(result && typeof result === "object"\)/, "arbitrary structured errors must not count as acknowledgements");

console.log("v1.16.3 response delivery regression passed");
