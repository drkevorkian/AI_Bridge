(() => {
  "use strict";

  if (window.__AI_BRIDGE_COMPLETION_GUARD_V1163__) return;
  window.__AI_BRIDGE_COMPLETION_GUARD_V1163__ = true;

  const host = location.hostname;
  const baselineByGeneration = new Map();
  const waiterByGeneration = new Map();
  const MAX_BASELINES = 8;
  const WAITER_POLL_MS = 500;
  const REPEATED_FORWARD_GRACE_MS = 1400;
  const MAX_HOLD_MS = 125 * 60 * 1000;
  let patched = false;
  let patchError = "";
  let baseSendMessage = null;

  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function cleanText(value) {
    let text = String(value || "").replace(/\u00a0/g, " ").replace(/\r/g, "").trim();
    text = text.replace(/^(?:Gemini|ChatGPT|Claude|Grok|Copilot)\s+(?:said|says)\s*[:：]?\s*(?:\n+|$)/i, "").trim();
    return text;
  }

  function candidateSelectors() {
    if (host === "chatgpt.com" || host === "chat.openai.com") {
      return ["[data-message-author-role='assistant'] .markdown", "[data-message-author-role='assistant']"];
    }
    if (host === "gemini.google.com") {
      return ["model-response", ".model-response", "[data-test-id='model-response']"];
    }
    if (host === "grok.com") {
      return ["article", "div[class*='message']"];
    }
    if (host === "claude.ai") {
      return ["div[data-is-streaming]", "div.font-claude-message", "div[class*='font-claude']"];
    }
    if (host === "copilot.microsoft.com") {
      return ["div[data-content='ai-message']", "div[class*='response']"];
    }
    return [];
  }

  function responseText(node) {
    if (!node) return "";
    if (host !== "gemini.google.com") return cleanText(node.innerText || node.textContent);

    const selectors = [
      "message-content.model-response-text div.markdown.markdown-main-panel",
      "message-content.model-response-text .markdown",
      ".model-response-text .markdown.markdown-main-panel",
      ".model-response-text .markdown",
      "div.response-content message-content.model-response-text",
      "message-content.model-response-text",
      ".model-response-text",
      ".response-content .markdown",
      ".response-content",
      ".markdown.markdown-main-panel",
      ".markdown"
    ];
    const candidates = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const candidate of node.querySelectorAll?.(selector) || []) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        const text = cleanText(candidate.innerText || candidate.textContent);
        if (text) candidates.push(text);
      }
    }
    const outer = cleanText(node.innerText || node.textContent);
    if (outer) candidates.push(outer);
    return candidates.sort((a, b) => b.length - a.length)[0] || "";
  }

  function latestResponseNode() {
    for (const selector of candidateSelectors()) {
      const nodes = [...document.querySelectorAll(selector)].filter(visible);
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (responseText(nodes[i]).length >= 2) return nodes[i];
      }
    }
    return null;
  }

  function responseIdentity(node) {
    if (!node) return null;
    return node.closest?.(
      "[data-message-author-role='assistant'], [data-message-id], model-response, [data-test-id='model-response'], article, [data-content='ai-message']"
    ) || node;
  }

  function currentResponseSnapshot() {
    const node = latestResponseNode();
    return {
      node,
      identity: responseIdentity(node),
      text: responseText(node)
    };
  }

  function settleWaiter(generationId, value, error = null) {
    const id = String(generationId || "");
    const waiter = waiterByGeneration.get(id);
    if (!waiter) return;
    waiterByGeneration.delete(id);
    if (waiter.timer) clearInterval(waiter.timer);
    if (error) waiter.reject(error);
    else waiter.resolve(value);
  }

  function supersedeOlderGenerations(keepId) {
    for (const id of [...baselineByGeneration.keys()]) {
      if (id === keepId) continue;
      baselineByGeneration.delete(id);
      settleWaiter(id, { ok: false, ignored: true, superseded: true });
    }
  }

  function rememberBaseline(generationId) {
    const id = String(generationId || "");
    if (!id) return;
    supersedeOlderGenerations(id);
    const snapshot = currentResponseSnapshot();
    baselineByGeneration.set(id, {
      node: snapshot.identity,
      text: snapshot.text,
      changed: false,
      createdAt: Date.now()
    });
    while (baselineByGeneration.size > MAX_BASELINES) {
      const oldestId = baselineByGeneration.keys().next().value;
      baselineByGeneration.delete(oldestId);
      settleWaiter(oldestId, { ok: false, ignored: true, superseded: true });
    }
  }

  function markChangedBaselines() {
    const snapshot = currentResponseSnapshot();
    for (const baseline of baselineByGeneration.values()) {
      if (baseline.changed || !baseline.node) continue;
      if (snapshot.identity === baseline.node && snapshot.text !== baseline.text) {
        baseline.changed = true;
      }
    }
  }

  // Some providers reuse one response container throughout generation. Track
  // whether the actual response text changes, not incidental controls in an
  // outer message shell, so UI chrome cannot masquerade as model progress.
  if (typeof MutationObserver === "function") {
    const mutationObserver = new MutationObserver(() => markChangedBaselines());
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function isUnchangedBaselineResponse(message) {
    if (!message || message.type !== "AI_BRIDGE_RESPONSE") return false;
    const id = String(message.generationId || "");
    const baseline = baselineByGeneration.get(id);
    if (!baseline) return false;

    markChangedBaselines();
    const snapshot = currentResponseSnapshot();
    const sameNode = Boolean(baseline.node && snapshot.identity === baseline.node);
    const sameText = Boolean(baseline.text && String(message.text || "").trim() === baseline.text);
    return sameNode && sameText && !baseline.changed;
  }

  function holdStaleResponse(message) {
    const id = String(message?.generationId || "");
    const existing = waiterByGeneration.get(id);
    if (existing) return existing.promise;

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const waiter = {
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer: null,
      checking: false,
      evidenceAt: 0
    };
    waiterByGeneration.set(id, waiter);

    waiter.timer = setInterval(async () => {
      const active = waiterByGeneration.get(id);
      if (!active || active.checking) return;
      active.checking = true;
      try {
        const baseline = baselineByGeneration.get(id);
        if (!baseline) {
          settleWaiter(id, { ok: false, ignored: true, superseded: true });
          return;
        }
        if (Date.now() - Number(baseline.createdAt || 0) > MAX_HOLD_MS) {
          baselineByGeneration.delete(id);
          settleWaiter(id, { ok: false, ignored: true, expired: true });
          return;
        }

        markChangedBaselines();
        const snapshot = currentResponseSnapshot();
        const freshIdentity = Boolean(snapshot.identity && snapshot.identity !== baseline.node);
        const freshEvidence = freshIdentity || baseline.changed;
        const repeatedText = Boolean(baseline.text && snapshot.text === baseline.text);

        // Different text will be reported by content.js through its normal path.
        // Keep this stale call pending until that newer call supersedes it.
        if (!freshEvidence || !repeatedText) {
          active.evidenceAt = 0;
          return;
        }

        if (!active.evidenceAt) {
          active.evidenceAt = Date.now();
          return;
        }
        if (Date.now() - active.evidenceAt < REPEATED_FORWARD_GRACE_MS) return;

        // A genuinely new response can legally be text-identical. content.js
        // already marked the stale attempt as reported before awaiting us, so it
        // will not issue another text-only send for this case. Forward the held
        // response now, but never reuse artifacts captured from the old DOM.
        baselineByGeneration.delete(id);
        waiterByGeneration.delete(id);
        if (active.timer) clearInterval(active.timer);
        const discardedArtifacts = Array.isArray(message.artifacts) ? message.artifacts.length : 0;
        const forwarded = {
          ...message,
          completedAt: Date.now(),
          artifacts: [],
          artifactDiagnostics: {
            candidateCount: 0,
            errors: discardedArtifacts
              ? ["Repeated response verified by fresh DOM evidence; pre-send artifact payload was discarded."]
              : []
          }
        };
        try {
          const result = await baseSendMessage(forwarded);
          active.resolve(result);
        } catch (err) {
          active.reject(err);
        }
      } finally {
        const remaining = waiterByGeneration.get(id);
        if (remaining) remaining.checking = false;
      }
    }, WAITER_POLL_MS);

    return promise;
  }

  try {
    baseSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function guardedSendMessage(...args) {
      const message = args.length === 1 && args[0] && typeof args[0] === "object" ? args[0] : null;
      if (isUnchangedBaselineResponse(message)) {
        return holdStaleResponse(message);
      }

      const id = message?.type === "AI_BRIDGE_RESPONSE" ? String(message.generationId || "") : "";
      if (id) {
        baselineByGeneration.delete(id);
        settleWaiter(id, { ok: false, ignored: true, superseded: true });
      }
      return baseSendMessage(...args);
    };
    patched = true;
  } catch (err) {
    patchError = String(err?.message || err || "sendMessage patch failed").slice(0, 240);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "AI_BRIDGE_SEND") {
      rememberBaseline(msg.generationId);
      return false;
    }
    if (msg?.type === "AI_BRIDGE_COMPLETION_GUARD_STATUS") {
      sendResponse({ ok: true, patched, error: patchError, version: "1.16.3" });
      return false;
    }
    return false;
  });
})();
