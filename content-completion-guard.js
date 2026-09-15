(() => {
  "use strict";

  if (window.__AI_BRIDGE_COMPLETION_GUARD_V1163__) return;
  window.__AI_BRIDGE_COMPLETION_GUARD_V1163__ = true;

  const host = location.hostname;
  const baselineByGeneration = new Map();
  const MAX_BASELINES = 8;
  let patched = false;
  let patchError = "";

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
      return ["[data-message-author-role='assistant']"];
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

  function latestResponseNode() {
    for (const selector of candidateSelectors()) {
      const nodes = [...document.querySelectorAll(selector)].filter(visible);
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (cleanText(nodes[i].innerText || nodes[i].textContent).length >= 2) return nodes[i];
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

  function baselineText(node) {
    if (!node) return "";
    return cleanText(node.innerText || node.textContent);
  }

  function rememberBaseline(generationId) {
    const id = String(generationId || "");
    if (!id) return;
    const node = latestResponseNode();
    baselineByGeneration.set(id, {
      node: responseIdentity(node),
      text: baselineText(node),
      createdAt: Date.now()
    });
    while (baselineByGeneration.size > MAX_BASELINES) {
      baselineByGeneration.delete(baselineByGeneration.keys().next().value);
    }
  }

  function shouldSuppressResponse(message) {
    if (!message || message.type !== "AI_BRIDGE_RESPONSE") return false;
    const id = String(message.generationId || "");
    const baseline = baselineByGeneration.get(id);
    if (!baseline) return false;

    const currentNode = responseIdentity(latestResponseNode());
    const sameNode = Boolean(baseline.node && currentNode === baseline.node);
    const sameText = Boolean(baseline.text && String(message.text || "").trim() === baseline.text);

    // The exact old response node and exact old response text cannot be the new
    // generation's completion. A new node is allowed even when its wording is
    // identical, preserving legitimate repeated/deterministic answers.
    if (sameNode && sameText) return true;

    baselineByGeneration.delete(id);
    return false;
  }

  try {
    const baseSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function guardedSendMessage(...args) {
      const message = args.length === 1 && args[0] && typeof args[0] === "object" ? args[0] : null;
      if (shouldSuppressResponse(message)) {
        return Promise.resolve({ ok: false, ignored: true, staleBaseline: true });
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
