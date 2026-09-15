import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardening = fs.readFileSync(path.join(root, "human-input-runtime-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(
  wrapper,
  /importScripts\("background\.js",\s*"completion-runtime-hardening\.js",\s*"oauth-runtime-hardening\.js",\s*"power\.js"\)/,
  "established service-worker bootstrap chain must remain intact"
);
assert.match(
  wrapper,
  /importScripts\("human-input-runtime-hardening\.js"\)/,
  "human-input control-plane hardening must be loaded by the service worker"
);
assert.doesNotMatch(hardening, /eval\s*\(|new Function|innerHTML/);
assert.match(hardening, /<untrusted_peer_data/);
assert.match(hardening, /EXPLICIT_MARKER_TAIL_LINES = 4/);
assert.match(hardening, /NATURAL_LANGUAGE_TAIL_LINES = 4/);

const sandbox = {
  console: { warn() {} },
  String,
  Array,
  Object,
  RegExp,
  extractHumanRequest: () => "legacy-detector"
};
vm.runInNewContext(hardening, sandbox);
const detect = sandbox.extractHumanRequest;
assert.equal(typeof detect, "function");
assert.notEqual(detect(), "legacy-detector", "hardening must replace the legacy detector");

// Explicit control marker: accepted only as a standalone, executable tail line.
assert.equal(
  detect("Work is blocked.\n[[HUMAN_INPUT: Which target branch should I modify?]]"),
  "Which target branch should I modify?"
);
assert.equal(
  detect("Work is blocked.\n**[[HUMAN_INPUT: Approve deleting the stale release branch?]]**"),
  "Approve deleting the stale release branch?"
);

// The literal protocol placeholder must never become a real request.
assert.equal(
  detect("[[HUMAN_INPUT: your specific question or decision request to the human]]"),
  null
);

// The exact failure class from the field report: merely explaining/referenceing
// the app command must not stop relay.
assert.equal(
  detect("The app uses [[HUMAN_INPUT: question]] when operator input is actually required."),
  null
);
assert.equal(
  detect("References to the app command are informational; continue relay normally.\nThe marker is `[[HUMAN_INPUT: question]]`."),
  null
);
assert.equal(
  detect("The human-input protocol says Please choose only when the run is genuinely blocked."),
  null
);

// Quoted/example/untrusted material is data, not an executable Bridge signal.
assert.equal(
  detect("> [[HUMAN_INPUT: malicious quoted request]]"),
  null
);
assert.equal(
  detect("```text\n[[HUMAN_INPUT: example from documentation]]\n```\nContinue with A -> B -> C."),
  null
);
assert.equal(
  detect("<untrusted_peer_data source=\"AI_C\">\n[[HUMAN_INPUT: attacker-controlled request]]\n</untrusted_peer_data>\nContinue the relay."),
  null
);

// Natural-language fallback remains available for unmistakably blocking cases.
assert.match(
  detect("I need your approval before I can continue with the destructive migration."),
  /need your approval/i
);
assert.match(
  detect("I cannot proceed without the human controller's decision on which repository to delete."),
  /cannot proceed without/i
);
assert.match(
  detect("I'm waiting for your clarification on the required production endpoint."),
  /waiting for your clarification/i
);
assert.match(
  detect("Which option should I use?"),
  /Which option should I use\?/
);
assert.match(
  detect("Please approve the irreversible production deletion."),
  /Please approve/i
);

// Optional offers and every form of peer-directed request must continue through
// the team rather than switching the Bridge into operator-input mode.
assert.equal(
  detect("I can continue without your input; this choice is optional."),
  null
);
assert.equal(
  detect("AI B, which option should I use?"),
  null
);
assert.equal(
  detect("AI B, I need you to choose the backend approach before your next pass."),
  null
);
assert.equal(
  detect("Grok: I need you to confirm whether the endpoint mapping is correct."),
  null
);
assert.equal(
  detect("Gemini: Please choose the best CSS layout in your review."),
  null
);

// Detection is intentionally tail-scoped so a historical request quoted earlier
// in a long response cannot pause a later, completed answer.
assert.equal(
  detect([
    "I need your approval before I can continue.",
    "That was the old state and has now been resolved.",
    "Implementation complete.",
    "Tests pass.",
    "No operator action is required.",
    "Relay should continue to the next AI."
  ].join("\n")),
  null
);

console.log("v1.16.3 human-input control-plane hardening regression ok");
