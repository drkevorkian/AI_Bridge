(() => {
  "use strict";

  const RANK = Object.freeze({
    EXACT_SEMANTIC: 0,
    ACCESSIBLE_EXACT: 1,
    STRUCTURAL: 2,
    BROAD_GENERIC: 3
  });

  const HEALTH = Object.freeze({ PASS: "PASS", DEGRADED: "DEGRADED", FAIL: "FAIL" });

  const freeze = items => Object.freeze(items.map(item => Object.freeze({ ...item })));

  const CONTRACTS = Object.freeze({
    chatgpt: Object.freeze({
      composer: freeze([
        { id: "chatgpt-composer-testid", selector: "#prompt-textarea", rank: RANK.EXACT_SEMANTIC },
        { id: "chatgpt-composer-virtualkeyboard", selector: "div[contenteditable='true'][data-virtualkeyboard='true']", rank: RANK.STRUCTURAL }
      ]),
      send: freeze([
        { id: "chatgpt-send-testid", selector: "button[data-testid='send-button']", rank: RANK.EXACT_SEMANTIC, enabled: true },
        { id: "chatgpt-send-aria", selector: "button[aria-label='Send prompt']", rank: RANK.ACCESSIBLE_EXACT, enabled: true },
        { id: "chatgpt-send-composer-id", selector: "button#composer-submit-button", rank: RANK.EXACT_SEMANTIC, enabled: true }
      ]),
      response: freeze([
        { id: "chatgpt-response-markdown", selector: "[data-message-author-role='assistant'] .markdown", rank: RANK.EXACT_SEMANTIC },
        { id: "chatgpt-response-container", selector: "[data-message-author-role='assistant']", rank: RANK.ACCESSIBLE_EXACT }
      ])
    }),
    grok: Object.freeze({
      composer: freeze([
        { id: "grok-chat-input-prosemirror", selector: "div.ProseMirror[data-testid='chat-input'][contenteditable='true'][role='textbox']", rank: RANK.EXACT_SEMANTIC },
        { id: "grok-chat-input-nested", selector: "[data-testid='chat-input'] div.ProseMirror[contenteditable='true'][role='textbox']", rank: RANK.EXACT_SEMANTIC },
        { id: "grok-prosemirror-aria", selector: "div.ProseMirror[contenteditable='true'][role='textbox'][aria-label*='Grok']", rank: RANK.ACCESSIBLE_EXACT },
        { id: "grok-ask-textarea", selector: "textarea[placeholder*='Ask']", rank: RANK.ACCESSIBLE_EXACT },
        { id: "grok-editable-aria", selector: "div[contenteditable='true'][aria-label*='Grok']", rank: RANK.ACCESSIBLE_EXACT }
      ]),
      send: freeze([
        { id: "grok-send-testid", selector: "button[data-testid='send-button']", rank: RANK.EXACT_SEMANTIC, enabled: true },
        { id: "grok-send-message", selector: "button[aria-label='Send message']", rank: RANK.ACCESSIBLE_EXACT, enabled: true },
        { id: "grok-send-aria", selector: "button[aria-label='Send']", rank: RANK.ACCESSIBLE_EXACT, enabled: true },
        { id: "grok-submit-aria", selector: "button[aria-label='Submit']", rank: RANK.ACCESSIBLE_EXACT, enabled: true }
      ]),
      response: freeze([
        { id: "grok-assistant-message", selector: "[data-testid='assistant-message']", rank: RANK.EXACT_SEMANTIC },
        { id: "grok-message-text", selector: "[data-testid='message-text']", rank: RANK.EXACT_SEMANTIC }
      ])
    }),
    claude: Object.freeze({
      composer: freeze([
        { id: "claude-prosemirror", selector: ".ProseMirror[contenteditable='true']", rank: RANK.STRUCTURAL }
      ]),
      send: freeze([
        { id: "claude-send-aria", selector: "button[aria-label='Send Message']", rank: RANK.ACCESSIBLE_EXACT, enabled: true }
      ]),
      response: freeze([
        { id: "claude-stream", selector: "div[data-is-streaming]", rank: RANK.STRUCTURAL },
        { id: "claude-message", selector: "div.font-claude-message", rank: RANK.STRUCTURAL }
      ])
    }),
    gemini: Object.freeze({
      composer: freeze([
        { id: "gemini-rich-textarea", selector: "rich-textarea div[contenteditable='true']", rank: RANK.EXACT_SEMANTIC }
      ]),
      send: freeze([
        { id: "gemini-send-aria", selector: "button[aria-label='Send message']", rank: RANK.ACCESSIBLE_EXACT, enabled: true }
      ]),
      response: freeze([
        { id: "gemini-message-content", selector: "message-content", rank: RANK.EXACT_SEMANTIC }
      ])
    }),
    copilot: Object.freeze({
      composer: freeze([
        { id: "copilot-searchbox", selector: "textarea#searchbox", rank: RANK.EXACT_SEMANTIC }
      ]),
      send: freeze([
        { id: "copilot-submit-aria", selector: "button[aria-label*='Submit']", rank: RANK.STRUCTURAL, enabled: true },
        { id: "copilot-send-aria", selector: "button[aria-label*='Send']", rank: RANK.STRUCTURAL, enabled: true }
      ]),
      response: freeze([
        { id: "copilot-message", selector: "cib-message", rank: RANK.EXACT_SEMANTIC },
        { id: "copilot-ai-message", selector: "div[data-content='ai-message']", rank: RANK.STRUCTURAL }
      ])
    })
  });

  function providerFromHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    if (host === "chatgpt.com" || host === "chat.openai.com") return "chatgpt";
    if (host === "grok.com") return "grok";
    if (host === "claude.ai") return "claude";
    if (host === "gemini.google.com") return "gemini";
    if (host === "copilot.microsoft.com") return "copilot";
    return null;
  }

  function usable(node, getStyle = globalThis.getComputedStyle) {
    if (!node || node.isConnected === false) return false;
    const rect = node.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = typeof getStyle === "function" ? getStyle(node) : null;
    if (style && (style.visibility === "hidden" || style.display === "none")) return false;
    if (node.hasAttribute?.("hidden")) return false;
    return true;
  }

  function enabled(node) {
    return Boolean(node) && node.disabled !== true && node.getAttribute?.("aria-disabled") !== "true";
  }

  function evaluate(provider, kind, queryAll, getStyle = globalThis.getComputedStyle) {
    const contracts = CONTRACTS[provider]?.[kind] || [];
    const results = [];
    for (const contract of contracts) {
      let nodes = [];
      try { nodes = Array.from(queryAll(contract.selector) || []); }
      catch (error) {
        results.push(Object.freeze({ id: contract.id, rank: contract.rank, state: HEALTH.FAIL, matchCount: 0, usableCount: 0, reason: "selector-error" }));
        continue;
      }
      const visible = nodes.filter(node => usable(node, getStyle));
      const candidates = visible.filter(node => !contract.enabled || enabled(node));
      let state = HEALTH.FAIL;
      let reason = "no-usable-match";
      if (candidates.length === 1 && contract.rank <= RANK.ACCESSIBLE_EXACT) {
        state = HEALTH.PASS;
        reason = "unique-high-confidence";
      } else if (candidates.length === 1 && contract.rank === RANK.STRUCTURAL) {
        state = HEALTH.DEGRADED;
        reason = "unique-structural";
      } else if (candidates.length > 1) {
        state = HEALTH.DEGRADED;
        reason = "ambiguous-match";
      } else if (visible.length === 1 && contract.enabled) {
        state = HEALTH.DEGRADED;
        reason = "visible-not-actionable";
      }
      results.push(Object.freeze({
        id: contract.id,
        rank: contract.rank,
        state,
        matchCount: nodes.length,
        visibleCount: visible.length,
        usableCount: candidates.length,
        reason,
        node: candidates.length === 1 ? candidates[0] : null
      }));
    }
    return results;
  }

  function authority(provider, kind, queryAll, getStyle = globalThis.getComputedStyle, { allowStructural = false } = {}) {
    const results = evaluate(provider, kind, queryAll, getStyle);
    const pass = results.find(item => item.state === HEALTH.PASS && item.node);
    if (pass) return Object.freeze({ state: HEALTH.PASS, selectorId: pass.id, node: pass.node, reason: pass.reason });
    if (allowStructural) {
      const degraded = results.find(item => item.state === HEALTH.DEGRADED && item.node && item.rank === RANK.STRUCTURAL);
      if (degraded) return Object.freeze({ state: HEALTH.DEGRADED, selectorId: degraded.id, node: degraded.node, reason: degraded.reason });
    }
    const first = results.find(item => item.usableCount > 0);
    return Object.freeze({ state: HEALTH.FAIL, selectorId: first?.id || null, node: null, reason: first?.reason || "no-contract-matched" });
  }

  function healthSnapshot(provider, queryAll, getStyle = globalThis.getComputedStyle) {
    const snapshot = {};
    for (const kind of ["composer", "send", "response"]) {
      const a = authority(provider, kind, queryAll, getStyle, { allowStructural: kind !== "send" });
      snapshot[kind] = Object.freeze({ state: a.state, selectorId: a.selectorId, reason: a.reason });
    }
    return Object.freeze(snapshot);
  }

  globalThis.AIBridgeDomResilience = Object.freeze({
    RANK,
    HEALTH,
    CONTRACTS,
    providerFromHost,
    evaluate,
    authority,
    healthSnapshot
  });
})();