(() => {
  if (window.__AI_BRIDGE_LOADED_V15__) return;
  window.__AI_BRIDGE_LOADED_V15__ = true;

  const host = location.hostname;
  let lastObservedText = "";
  let lastChangeAt = 0;
  let lastReportedText = "";
  let pendingSend = false;

  const adapters = {
    chatgpt: {
      matches: () => host === "chatgpt.com" || host === "chat.openai.com",
      inputSelectors: [
        "#prompt-textarea",
        "textarea[data-id='root']",
        "div[contenteditable='true'][data-virtualkeyboard='true']",
        "div[contenteditable='true']"
      ],
      sendSelectors: [
        "button[data-testid='send-button']",
        "button[aria-label*='Send']",
        "button[aria-label*='send']"
      ],
      responseSelectors: [
        "[data-message-author-role='assistant'] .markdown",
        "[data-message-author-role='assistant']"
      ],
      stopSelectors: [
        "button[data-testid='stop-button']",
        "button[aria-label*='Stop']"
      ]
    },
    grok: {
      matches: () => host === "grok.com",
      inputSelectors: ["textarea", "div[contenteditable='true']"],
      sendSelectors: ["button[aria-label*='Send']", "button[type='submit']"],
      responseSelectors: ["article", "div[class*='message']"],
      stopSelectors: ["button[aria-label*='Stop']", "button[title*='Stop']"]
    },
    claude: {
      matches: () => host === "claude.ai",
      inputSelectors: ["div[contenteditable='true']", "textarea"],
      sendSelectors: ["button[aria-label*='Send']", "button[type='submit']"],
      responseSelectors: [
        "div[data-is-streaming]",
        "div.font-claude-message",
        "div[class*='font-claude']"
      ],
      stopSelectors: ["button[aria-label*='Stop']"]
    },
    gemini: {
      matches: () => host === "gemini.google.com",
      inputSelectors: ["div[contenteditable='true']", "textarea"],
      sendSelectors: ["button[aria-label*='Send']", "button.send-button"],
      responseSelectors: ["model-response", ".model-response-text", "message-content"],
      stopSelectors: ["button[aria-label*='Stop']"]
    },
    copilot: {
      matches: () => host === "copilot.microsoft.com",
      inputSelectors: ["textarea", "div[contenteditable='true']"],
      sendSelectors: [
        "button[aria-label*='Submit']",
        "button[aria-label*='Send']",
        "button[type='submit']"
      ],
      responseSelectors: ["div[data-content='ai-message']", "div[class*='response']"],
      stopSelectors: ["button[aria-label*='Stop']"]
    }
  };

  const adapter = Object.values(adapters).find(a => a.matches());
  if (!adapter) return;

  function firstVisible(selectors) {
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)];
      const node = nodes.find(el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      });
      if (node) return node;
    }
    return null;
  }

  function allVisible(selectors) {
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter(el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      });
      if (nodes.length) return nodes;
    }
    return [];
  }

  function setNativeValue(el, text) {
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    if (el.isContentEditable) {
      el.innerHTML = "";
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (i) el.appendChild(document.createElement("br"));
        el.appendChild(document.createTextNode(line));
      });
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      }));
    }
  }

  async function sendPrompt(text) {
    lastReportedText = "";
    const input = firstVisible(adapter.inputSelectors);
    if (!input) throw new Error("Could not find the prompt box on this page.");

    pendingSend = true;
    setNativeValue(input, text);
    await new Promise(r => setTimeout(r, 300));

    const button = firstVisible(adapter.sendSelectors);
    if (button && !button.disabled) {
      button.click();
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true
      }));
      input.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true
      }));
    }

    lastObservedText = "";
    lastChangeAt = Date.now();
    setTimeout(() => { pendingSend = false; }, 1200);
  }

  function latestResponseText() {
    const nodes = allVisible(adapter.responseSelectors);
    if (!nodes.length) return "";

    for (let i = nodes.length - 1; i >= 0; i--) {
      const text = (nodes[i].innerText || nodes[i].textContent || "").trim();
      if (text.length >= 2) return text;
    }
    return "";
  }

  function generationAppearsActive() {
    return Boolean(firstVisible(adapter.stopSelectors));
  }

  async function monitor() {
    const text = latestResponseText();
    if (!text) return;

    if (text !== lastObservedText) {
      lastObservedText = text;
      lastChangeAt = Date.now();
      return;
    }

    if (pendingSend) return;
    if (generationAppearsActive()) return;
    if (Date.now() - lastChangeAt < 2200) return;
    if (text === lastReportedText) return;

    lastReportedText = text;
    try {
      await chrome.runtime.sendMessage({ type: "AI_BRIDGE_RESPONSE", text });
    } catch (_) {}
  }

  const observer = new MutationObserver(() => {});
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(monitor, 650);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "AI_BRIDGE_PING") {
      sendResponse({ ok: true, host: location.hostname, ready: true });
      return false;
    }

    if (msg.type === "AI_BRIDGE_SEND") {
      sendPrompt(String(msg.text || ""))
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });
})();
