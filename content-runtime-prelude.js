(() => {
  "use strict";

  const RUNTIME_VERSION = "1.17.1";
  const FLAG = "__AI_BRIDGE_CONTENT_RUNTIME_PRELUDE__";
  if (window[FLAG]?.version === RUNTIME_VERSION) return;

  try {
    if (window.__AI_BRIDGE_MONITOR_TIMER__) {
      clearInterval(window.__AI_BRIDGE_MONITOR_TIMER__);
      window.__AI_BRIDGE_MONITOR_TIMER__ = null;
    }
  } catch (_) {}

  const nativeSetInterval = window.setInterval.bind(window);
  let monitorCaptured = false;
  window.setInterval = function hardenedSetInterval(callback, delay, ...args) {
    const handle = nativeSetInterval(callback, delay, ...args);
    if (!monitorCaptured && Number(delay) === 650 && typeof callback === "function" && callback.name === "monitor") {
      monitorCaptured = true;
      try {
        if (window.__AI_BRIDGE_MONITOR_TIMER__ && window.__AI_BRIDGE_MONITOR_TIMER__ !== handle) {
          clearInterval(window.__AI_BRIDGE_MONITOR_TIMER__);
        }
      } catch (_) {}
      window.__AI_BRIDGE_MONITOR_TIMER__ = handle;
      window.setInterval = nativeSetInterval;
    }
    return handle;
  };

  const acceptedSends = new Map();
  const MAX_ACCEPTED_SENDS = 64;
  const SEND_ACK_TIMEOUT_MS = 8000;
  const SEND_ACK_POLL_MS = 100;

  function rememberAcceptedSend(generationId, text) {
    const id = String(generationId || "");
    if (!id) return;
    acceptedSends.set(id, String(text || ""));
    while (acceptedSends.size > MAX_ACCEPTED_SENDS) {
      acceptedSends.delete(acceptedSends.keys().next().value);
    }
  }

  function normalizedComparableText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function safeQueryAll(selector) {
    try {
      return [...document.querySelectorAll(selector)];
    } catch (_) {
      return [];
    }
  }

  function isVisible(element) {
    if (!element) return false;
    try {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    } catch (_) {
      return false;
    }
  }

  function visibleNodes(selectors) {
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of safeQueryAll(selector)) {
        if (seen.has(element) || !isVisible(element)) continue;
        seen.add(element);
        out.push(element);
      }
    }
    return out;
  }

  function nodeComparableText(element) {
    if (!element) return "";
    if ("value" in element && typeof element.value === "string") {
      return normalizedComparableText(element.value);
    }
    return normalizedComparableText(element.innerText || element.textContent || "");
  }

  function providerProbe() {
    const host = location.hostname;
    if (host === "chatgpt.com" || host === "chat.openai.com") {
      return {
        composers: ["#prompt-textarea", "textarea[data-id='root']", "div[contenteditable='true'][data-virtualkeyboard='true']"],
        stop: ["button[data-testid='stop-button']", "button[aria-label*='Stop']"],
        userMessages: ["[data-message-author-role='user']"]
      };
    }
    if (host === "grok.com") {
      return {
        composers: ["textarea", "div[contenteditable='true']"],
        stop: ["button[aria-label*='Stop']", "button[title*='Stop']"],
        userMessages: ["[data-testid*='user-message']", "article"]
      };
    }
    if (host === "claude.ai") {
      return {
        composers: ["div[contenteditable='true'].ProseMirror", "div[contenteditable='true']", "textarea"],
        stop: ["button[aria-label*='Stop']"],
        userMessages: ["[data-testid*='user-message']", "[data-testid*='human']"]
      };
    }
    if (host === "gemini.google.com") {
      return {
        composers: ["rich-textarea div[contenteditable='true']", "div[contenteditable='true']", "textarea"],
        stop: ["button[aria-label*='Stop']", "button[aria-label*='stop']", ".stop-button"],
        userMessages: ["user-query", ".user-query", "[data-test-id='user-query']"]
      };
    }
    if (host === "copilot.microsoft.com") {
      return {
        composers: ["textarea#searchbox", "textarea", "div[contenteditable='true']"],
        stop: ["button[aria-label*='Stop']"],
        userMessages: ["cib-message[type='user']", "[data-content='user-message']"]
      };
    }
    return { composers: [], stop: [], userMessages: [] };
  }

  function sendBaseline() {
    const probe = providerProbe();
    return {
      href: location.href,
      userMessageCount: visibleNodes(probe.userMessages).length
    };
  }

  function providerAcknowledgedSend(promptText, baseline) {
    const probe = providerProbe();
    if (visibleNodes(probe.stop).some(element => !element.disabled)) return true;
    if (baseline?.href && location.href !== baseline.href) return true;
    if (visibleNodes(probe.userMessages).length > Number(baseline?.userMessageCount || 0)) return true;
    const composers = visibleNodes(probe.composers);
    const expected = normalizedComparableText(promptText);
    if (composers.length && expected) {
      const values = composers.map(nodeComparableText);
      if (!values.some(value => value === expected) && values.some(value => value.length < Math.min(8, expected.length))) {
        return true;
      }
    }
    return false;
  }

  async function waitForProviderSendAcknowledgement(promptText, baseline) {
    const deadline = Date.now() + SEND_ACK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (providerAcknowledgedSend(promptText, baseline)) return true;
      await new Promise(resolve => setTimeout(resolve, SEND_ACK_POLL_MS));
    }
    return providerAcknowledgedSend(promptText, baseline);
  }

  const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = function hardenedRuntimeSendMessage(message, ...args) {
    if (message?.type === "AI_BRIDGE_RESPONSE") {
      const id = String(message.generationId || "");
      const sent = acceptedSends.get(id);
      if (id && sent !== undefined && normalizedComparableText(message.text) === normalizedComparableText(sent)) {
        return Promise.resolve({ ok: false, ignored: true, promptEcho: true });
      }
    }
    return nativeSendMessage(message, ...args);
  };

  const nativeAddListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
  chrome.runtime.onMessage.addListener = function versionedAddListener(listener) {
    if (typeof listener !== "function") return nativeAddListener(listener);
    return nativeAddListener((message, sender, sendResponse) => {
      if (message?.type === "AI_BRIDGE_PING") {
        const versionedResponse = value => {
          if (value && typeof value === "object") {
            sendResponse({ ...value, version: RUNTIME_VERSION, runtimeVersion: RUNTIME_VERSION });
          } else {
            sendResponse(value);
          }
        };
        return listener(message, sender, versionedResponse);
      }

      if (message?.type === "AI_BRIDGE_SEND") {
        const generationId = String(message.generationId || "");
        if (generationId && acceptedSends.has(generationId)) {
          sendResponse({ ok: true, duplicateSend: true, generationId, uploadedCount: Array.isArray(message.artifacts) ? message.artifacts.length : 0 });
          return false;
        }

        const baseline = sendBaseline();
        const trackedResponse = async value => {
          if (value?.ok === true && generationId) {
            const acknowledged = await waitForProviderSendAcknowledgement(message.text, baseline);
            if (!acknowledged) {
              sendResponse({
                ok: false,
                error: "The provider did not visibly acknowledge prompt submission. AI Bridge will not mark this generation as sent.",
                generationId,
                sendAcknowledged: false
              });
              return;
            }
            rememberAcceptedSend(generationId, message.text);
            sendResponse({ ...value, sendAcknowledged: true });
            return;
          }
          sendResponse(value);
        };
        return listener(message, sender, trackedResponse);
      }

      return listener(message, sender, sendResponse);
    });
  };

  window[FLAG] = Object.freeze({
    version: RUNTIME_VERSION,
    monitorTimerOwned: true,
    sendIdempotency: true,
    promptEchoFilter: true,
    providerSendAcknowledgement: true
  });
})();
