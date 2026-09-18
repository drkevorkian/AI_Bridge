import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "content-response-delivery-hardening.js"), "utf8");

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createHarness(sendImpl) {
  const window = {};
  const chrome = {
    runtime: {
      sendMessage: (...args) => sendImpl(...args)
    }
  };
  const context = vm.createContext({
    window,
    chrome,
    console,
    Promise,
    Map,
    Set,
    Number,
    String,
    Boolean,
    Math,
    setTimeout: (fn, _ms) => setTimeout(fn, 0),
    clearTimeout
  });
  vm.runInContext(source, context, { filename: "content-response-delivery-hardening.js" });
  return { window, chrome };
}

function response(text, completedAt, generationId = "gen-1") {
  return {
    type: "AI_BRIDGE_RESPONSE",
    text,
    completedAt,
    generationId,
    artifacts: [],
    artifactDiagnostics: { candidateCount: 0, errors: [] }
  };
}

// Overlapping monitor ticks for the same completed response share one
// downstream delivery while the first send is still pending.
{
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { chrome } = createHarness(() => {
    calls += 1;
    return pending;
  });
  const msg = response("same answer", 100);
  const first = chrome.runtime.sendMessage(msg);
  const second = chrome.runtime.sendMessage(msg);
  assert.equal(first, second);
  assert.equal(calls, 1);
  release({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { ok: true });
  assert.equal(calls, 1);
}

// A transient rejected send remains live inside the wrapper and retries until
// the service worker acknowledges it.
{
  let calls = 0;
  const { chrome } = createHarness(async () => {
    calls += 1;
    if (calls === 1) throw new Error("Receiving end does not exist");
    return { ok: true, accepted: true };
  });
  const result = await chrome.runtime.sendMessage(response("retry me", 200));
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
}

// undefined/no-response is not an acknowledgement and must be retried.
{
  let calls = 0;
  const { chrome } = createHarness(async () => {
    calls += 1;
    return calls === 1 ? undefined : { ok: true };
  });
  const result = await chrome.runtime.sendMessage(response("no ack", 300));
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
}

// A successful acknowledgement is cached so content.js cannot advance the
// background twice if another overlapping capture reaches sendMessage later.
{
  let calls = 0;
  const { chrome } = createHarness(async () => {
    calls += 1;
    return { ok: true, duplicate: false };
  });
  const msg = response("one delivery", 400);
  await chrome.runtime.sendMessage(msg);
  await chrome.runtime.sendMessage(msg);
  assert.equal(calls, 1);
}

// A genuinely newer response is not blocked behind an older held response.
{
  let calls = 0;
  const { chrome } = createHarness(message => {
    calls += 1;
    if (message.text === "old") return new Promise(() => {});
    return Promise.resolve({ ok: true, text: message.text });
  });
  const oldPromise = chrome.runtime.sendMessage(response("old", 500));
  await tick();
  const newer = await chrome.runtime.sendMessage(response("new", 600));
  const oldResult = await oldPromise;
  assert.equal(newer.ok, true);
  assert.equal(oldResult.superseded, true);
  assert.equal(calls, 2);
}

// A slow artifact capture can finish after a newer DOM state. That older
// response must be rejected locally and never sent after the newer response.
{
  let calls = 0;
  const { chrome } = createHarness(async message => {
    calls += 1;
    return { ok: true, text: message.text };
  });
  await chrome.runtime.sendMessage(response("newest", 800));
  const stale = await chrome.runtime.sendMessage(response("stale", 700));
  assert.equal(stale.superseded, true);
  assert.equal(stale.staleDelivery, true);
  assert.equal(calls, 1);
}

// Identical wording from a later generation is a distinct response.
{
  let calls = 0;
  const { chrome } = createHarness(async () => {
    calls += 1;
    return { ok: true };
  });
  await chrome.runtime.sendMessage(response("same words", 900, "gen-a"));
  await chrome.runtime.sendMessage(response("same words", 900, "gen-b"));
  assert.equal(calls, 2);
}

// Completion-guard/background terminal objects are acknowledgements and must
// not be retried into a response storm.
{
  let calls = 0;
  const { chrome } = createHarness(async () => {
    calls += 1;
    return { ok: false, ignored: true, superseded: true };
  });
  const msg = response("terminal", 1000);
  const first = await chrome.runtime.sendMessage(msg);
  const second = await chrome.runtime.sendMessage(msg);
  assert.equal(first.superseded, true);
  assert.equal(second.superseded, true);
  assert.equal(calls, 1);
}

// An invalidated extension context cannot recover from the old page world;
// reject so background reconnect can reinject a fresh content runtime.
{
  let calls = 0;
  const { chrome } = createHarness(async () => {
    calls += 1;
    throw new Error("Extension context invalidated.");
  });
  await assert.rejects(
    chrome.runtime.sendMessage(response("reload", 1100)),
    /Extension context invalidated/i
  );
  assert.equal(calls, 1);
}

// Tracking is bounded even across many generations.
{
  const { chrome, window } = createHarness(async () => ({ ok: true }));
  for (let i = 0; i < 80; i += 1) {
    await chrome.runtime.sendMessage(response(`answer-${i}`, 2000 + i, `gen-${i}`));
  }
  const status = window.__AI_BRIDGE_RESPONSE_DELIVERY_STATUS__();
  assert.ok(status.settled <= 64);
  assert.ok(status.generations <= 64);
}

console.log("v1.16.3 response delivery hardening regression checks passed.");
