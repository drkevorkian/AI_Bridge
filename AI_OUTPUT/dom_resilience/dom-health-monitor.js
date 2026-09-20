/**
 * dom-health-monitor.js
 * Review-only dirty-probe scheduler. It does not own selector semantics and
 * never blocks dashboard/control-plane startup.
 */

export const PROBES = Object.freeze(["composer", "send", "stop", "response", "upload", "new_chat", "limit_state", "conversation_identity"]);

const SAFE_PROBE_FIELDS = Object.freeze(new Set([
  "policy", "state", "selectorId", "rank", "matchCount", "usableCount",
  "reason", "nodeConnected", "provider", "capability", "confidence"
]));

function sanitizeProbeValue(value) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value !== "object" || Array.isArray(value)) return null;

  const clean = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!SAFE_PROBE_FIELDS.has(key)) continue;
    if (fieldValue == null || typeof fieldValue === "boolean" || typeof fieldValue === "number") {
      clean[key] = fieldValue;
    } else if (typeof fieldValue === "string") {
      clean[key] = fieldValue.slice(0, 200);
    }
  }
  return Object.freeze(clean);
}

function safeProbeName(value) {
  const name = String(value || "");
  return PROBES.includes(name) ? name : null;
}

export class DomHealthMonitor {
  constructor({ runProbe, emit, debounceMs = 200, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (typeof runProbe !== "function") throw new TypeError("runProbe is required.");
    this.runProbe = runProbe;
    this.emit = typeof emit === "function" ? emit : () => {};
    this.debounceMs = Math.max(50, Math.min(1000, Number(debounceMs) || 200));
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.dirty = new Set(PROBES);
    this.timer = null;
    this.visible = true;
    this.disposed = false;
  }

  markDirty(...names) {
    if (this.disposed) return;
    for (const raw of names.flat()) {
      const name = safeProbeName(raw);
      if (name) this.dirty.add(name);
    }
    this.schedule();
  }

  classifyMutations(records = []) {
    const dirtied = new Set();
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      if (record.type === "characterData") {
        dirtied.add("response");
        continue;
      }
      if (record.type === "attributes") {
        dirtied.add("composer");
        dirtied.add("send");
        dirtied.add("stop");
        dirtied.add("new_chat");
        dirtied.add("limit_state");
        continue;
      }
      if (record.type === "childList") {
        for (const name of PROBES) dirtied.add(name);
      }
    }
    this.markDirty([...dirtied]);
    return [...dirtied];
  }

  routeChanged() {
    this.markDirty(...PROBES);
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    if (this.visible) this.schedule();
    else if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
  }

  schedule() {
    if (this.disposed || !this.visible || this.timer || !this.dirty.size) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush().catch(error => this.emit({ type: "AI_BRIDGE_DOM_HEALTH_ERROR", message: String(error?.message || error).slice(0, 200) }));
    }, this.debounceMs);
  }

  async flush() {
    if (this.disposed || !this.visible) return [];
    const pending = [...this.dirty];
    this.dirty.clear();
    const results = [];
    for (const name of pending) {
      try {
        const value = sanitizeProbeValue(await this.runProbe(name));
        results.push({ name, ok: true, value });
      } catch (error) {
        results.push({ name, ok: false, error: String(error?.message || error).slice(0, 200) });
      }
    }
    this.emit({ type: "AI_BRIDGE_DOM_HEALTH", results });
    if (this.dirty.size) this.schedule();
    return results;
  }

  dispose() {
    this.disposed = true;
    this.dirty.clear();
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }
}
