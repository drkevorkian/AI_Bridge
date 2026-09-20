import assert from "node:assert/strict";
import { DomHealthMonitor } from "../dom_resilience/dom-health-monitor.js";

const calls=[]; const events=[];
const monitor=new DomHealthMonitor({
  runProbe: async name => { calls.push(name); return {state:"PASS"}; },
  emit: event => events.push(event),
  debounceMs: 50
});
monitor.dirty.clear();
monitor.classifyMutations([{type:"characterData"}]);
await new Promise(r=>setTimeout(r,70));
assert.deepEqual(calls,["response"]);
calls.length=0;
monitor.routeChanged();
await new Promise(r=>setTimeout(r,70));
assert.ok(calls.includes("conversation_identity"));
monitor.dispose();
assert.ok(events.some(e=>e.type==="AI_BRIDGE_DOM_HEALTH"));
console.log("dom-health-monitor: PASS");
