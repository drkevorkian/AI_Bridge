(() => {
  if (window.__AI_BRIDGE_LOADED_V111__) return;
  window.__AI_BRIDGE_LOADED_V111__ = true;

  const host = location.hostname;
  let lastObservedText = "";
  let lastChangeAt = 0;
  let lastReportedText = "";
  let lastReportedSignature = "";
  let pendingSend = false;
  const MAX_ARTIFACTS_PER_RESPONSE = 8;
  const MAX_ARTIFACT_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_ARTIFACT_TOTAL_BYTES = 24 * 1024 * 1024;
  const ARTIFACT_FETCH_TIMEOUT_MS = 15000;

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
      ],
      fileInputSelectors: ["input[type='file']"],
      uploadButtonSelectors: [
        "button[aria-label*='Attach']", "button[aria-label*='Upload']",
        "button[data-testid*='attach']", "button[data-testid*='upload']"
      ]
    },
    grok: {
      matches: () => host === "grok.com",
      inputSelectors: ["textarea", "div[contenteditable='true']"],
      sendSelectors: ["button[aria-label*='Send']", "button[type='submit']"],
      responseSelectors: ["article", "div[class*='message']"],
      stopSelectors: ["button[aria-label*='Stop']", "button[title*='Stop']"],
      fileInputSelectors: ["input[type='file']"],
      uploadButtonSelectors: ["button[aria-label*='Attach']", "button[aria-label*='Upload']", "button[title*='Attach']"]
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
      stopSelectors: ["button[aria-label*='Stop']"],
      fileInputSelectors: ["input[type='file']"],
      uploadButtonSelectors: ["button[aria-label*='Attach']", "button[aria-label*='Upload']", "button[aria-label*='Add']"]
    },
    gemini: {
      matches: () => host === "gemini.google.com",
      inputSelectors: ["div[contenteditable='true']", "textarea"],
      sendSelectors: ["button[aria-label*='Send']", "button.send-button"],
      responseSelectors: [
        "model-response",
        ".model-response",
        "[data-test-id='model-response']",
        ".model-response-text",
        "message-content"
      ],
      stopSelectors: [
        "button[aria-label*='Stop']",
        "button[aria-label*='stop']",
        "button:has(mat-icon[data-mat-icon-name='stop'])",
        "button:has(mat-icon[fonticon='stop'])",
        ".stop-button"
      ],
      fileInputSelectors: ["input[type='file']"],
      uploadButtonSelectors: ["button[aria-label*='Attach']", "button[aria-label*='Upload']", "button[aria-label*='Add']"]
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
      stopSelectors: ["button[aria-label*='Stop']"],
      fileInputSelectors: ["input[type='file']"],
      uploadButtonSelectors: ["button[aria-label*='Attach']", "button[aria-label*='Upload']", "button[aria-label*='Add']"]
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
      el.replaceChildren();
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function base64ToFile(item) {
    const binary = atob(String(item.dataBase64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], String(item.name || "artifact.bin"), {
      type: String(item.mime || "application/octet-stream"),
      lastModified: Date.now()
    });
  }

  async function findUploadInput() {
    let input = firstVisible(adapter.fileInputSelectors || ["input[type='file']"])
      || document.querySelector((adapter.fileInputSelectors || ["input[type='file']"]).join(","));
    if (input) return input;

    const trigger = firstVisible(adapter.uploadButtonSelectors || []);
    if (trigger) {
      trigger.click();
      for (let i = 0; i < 12; i++) {
        await sleep(150);
        input = document.querySelector((adapter.fileInputSelectors || ["input[type='file']"]).join(","));
        if (input) return input;
      }
    }
    return null;
  }

  async function uploadArtifacts(items) {
    const artifacts = Array.isArray(items) ? items.filter(item => item?.dataBase64) : [];
    if (!artifacts.length) return 0;

    let input = await findUploadInput();
    if (!input) throw new Error("Could not find a file-upload control on this AI page.");

    const files = artifacts.map(base64ToFile);
    if (input.multiple || files.length === 1) {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(900);
      return files.length;
    }

    let uploaded = 0;
    for (const file of files) {
      input = await findUploadInput();
      if (!input) throw new Error(`Could not attach ${file.name}.`);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      uploaded += 1;
      await sleep(650);
    }
    return uploaded;
  }

  function visibleNewChatControl() {
    const candidates = [...document.querySelectorAll("button, a")];
    return candidates.find(el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") return false;
      const label = [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.textContent
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      return /\b(new chat|new conversation|new topic|start new chat)\b/i.test(label);
    }) || null;
  }

  async function openNewConversation() {
    const control = visibleNewChatControl();
    if (!control) return { clicked: false };
    control.click();
    await sleep(700);
    return { clicked: true };
  }

  async function sendPrompt(text, artifacts = []) {
    lastReportedText = "";
    lastReportedSignature = "";
    const input = firstVisible(adapter.inputSelectors);
    if (!input) throw new Error("Could not find the prompt box on this page.");

    pendingSend = true;
    const uploadedCount = await uploadArtifacts(artifacts);
    setNativeValue(input, text);
    await sleep(uploadedCount ? 650 : 300);

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
    setTimeout(() => { pendingSend = false; }, uploadedCount ? 2200 : 1200);
    return uploadedCount;
  }

  function rawNodeText(node) {
    return String(node?.innerText || node?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .trim();
  }

  function cleanResponseText(text) {
    let value = String(text || "").replace(/\u00a0/g, " ").replace(/\r/g, "").trim();
    // Provider accessibility headings can be included in outer-container innerText.
    // They are labels, not the assistant's answer.
    value = value.replace(/^(?:Gemini|ChatGPT|Claude|Grok|Copilot)\s+(?:said|says)\s*[:：]?\s*(?:\n+|$)/i, "").trim();
    return value;
  }

  function geminiResponseText(node) {
    if (!node) return "";
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
        const text = cleanResponseText(rawNodeText(candidate));
        if (text) candidates.push(text);
      }
    }
    const outer = cleanResponseText(rawNodeText(node));
    if (outer) candidates.push(outer);
    // The real answer is normally the richest text block. This avoids Gemini's
    // short accessibility header such as "Gemini said" winning the scrape.
    return candidates.sort((a, b) => b.length - a.length)[0] || "";
  }

  function latestResponseNode() {
    if (host === "gemini.google.com") {
      const models = [...document.querySelectorAll("model-response, .model-response, [data-test-id='model-response']")]
        .filter(el => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        });
      if (models.length) return models[models.length - 1];
    }

    const nodes = allVisible(adapter.responseSelectors);
    if (!nodes.length) return null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const text = cleanResponseText(rawNodeText(nodes[i]));
      if (text.length >= 2) return nodes[i];
    }
    return null;
  }

  function latestResponseText(node = latestResponseNode()) {
    if (host === "gemini.google.com") return geminiResponseText(node);
    return cleanResponseText(rawNodeText(node));
  }

  function isResponseStub(text) {
    const value = String(text || "").trim();
    return !value || /^(?:Gemini|ChatGPT|Claude|Grok|Copilot)\s+(?:said|says)\s*[:：]?[.!]?$/i.test(value);
  }

  function artifactRoot(node) {
    return node?.closest?.("[data-message-author-role='assistant'], [data-message-id], article, model-response") || node;
  }

  function looksLikeDownload(anchor) {
    const rawHref = String(anchor.getAttribute("href") || "");
    const href = String(anchor.href || rawHref);
    const text = String(anchor.textContent || "").trim();
    const aria = String(anchor.getAttribute("aria-label") || "");
    const testId = String(anchor.getAttribute("data-testid") || "");
    return Boolean(
      anchor.hasAttribute("download") ||
      /^(blob:|data:|sandbox:)/i.test(rawHref) ||
      /\b(download|attachment|artifact|file)\b/i.test(`${aria} ${testId}`) ||
      /\/interpreter\/download\b/i.test(href) ||
      /\/download(?:[/?#]|$)/i.test(href) ||
      (/\.(zip|7z|tar|tgz|gz|bz2|xz|rar|py|js|ts|tsx|jsx|json|txt|md|csv|pdf|docx|xlsx|pptx)(?:$|[?#])/i.test(text) && /download/i.test(`${text} ${aria}`))
    );
  }

  function datasetUrls(anchor) {
    const urls = [];
    for (const value of Object.values(anchor.dataset || {})) {
      const candidate = String(value || "").trim();
      if (/^(https?:|blob:|data:)/i.test(candidate)) urls.push(candidate);
    }
    return urls;
  }

  function chatGptSandboxUrl(anchor, sandboxHref) {
    if (!(host === "chatgpt.com" || host === "chat.openai.com")) return "";
    const sandboxPath = String(sandboxHref || "").replace(/^sandbox:/i, "");
    if (!sandboxPath.startsWith("/mnt/data/")) return "";
    const conversationMatch = location.pathname.match(/(?:^|\/)c\/([^/?#]+)/);
    const messageNode = anchor.closest?.("[data-message-id]") || artifactRoot(anchor);
    const messageId = messageNode?.getAttribute?.("data-message-id") || messageNode?.dataset?.messageId || "";
    if (!conversationMatch?.[1] || !messageId) return "";
    return `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationMatch[1])}/interpreter/download?message_id=${encodeURIComponent(messageId)}&sandbox_path=${encodeURIComponent(sandboxPath)}`;
  }

  function artifactUrl(anchor) {
    const rawHref = String(anchor.getAttribute("href") || "").trim();
    const candidates = [String(anchor.href || ""), ...datasetUrls(anchor), rawHref].filter(Boolean);
    for (const candidate of candidates) {
      if (/^(https?:|blob:|data:)/i.test(candidate)) return candidate;
    }
    if (/^sandbox:/i.test(rawHref)) return chatGptSandboxUrl(anchor, rawHref);
    return "";
  }

  function artifactName(anchor, url, index) {
    const explicit = String(anchor.getAttribute("download") || "").trim();
    if (explicit) return explicit.slice(0, 240);
    try {
      const parsed = new URL(url, location.href);
      const sandboxPath = parsed.searchParams.get("sandbox_path");
      const path = sandboxPath || decodeURIComponent(parsed.pathname || "");
      const name = path.split("/").filter(Boolean).pop();
      if (name) return name.slice(0, 240);
    } catch (_) {}
    const text = String(anchor.textContent || "").trim();
    if (text && text.length <= 240) return text.replace(/[\\/]/g, "_");
    return `artifact-${index + 1}.bin`;
  }

  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  async function fetchArtifact(anchor, index) {
    const url = artifactUrl(anchor);
    if (!url) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARTIFACT_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_ARTIFACT_FILE_BYTES) throw new Error("file too large");
      const blob = await response.blob();
      if (blob.size <= 0 || blob.size > MAX_ARTIFACT_FILE_BYTES) throw new Error("file too large or empty");
      return {
        name: artifactName(anchor, url, index),
        mime: blob.type || response.headers.get("content-type") || "application/octet-stream",
        size: blob.size,
        dataBase64: await blobToBase64(blob)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function artifactAnchorSignature(node) {
    const root = artifactRoot(node);
    const anchors = [...(root?.querySelectorAll?.("a[href]") || [])].filter(looksLikeDownload).slice(0, MAX_ARTIFACTS_PER_RESPONSE);
    return anchors.map((anchor, index) => `${artifactUrl(anchor)}|${artifactName(anchor, artifactUrl(anchor), index)}`).join("||");
  }

  async function captureArtifacts(node) {
    const root = artifactRoot(node);
    const anchors = [...(root?.querySelectorAll?.("a[href]") || [])].filter(looksLikeDownload).slice(0, MAX_ARTIFACTS_PER_RESPONSE);
    const artifacts = [];
    let total = 0;
    for (let i = 0; i < anchors.length; i++) {
      try {
        const artifact = await fetchArtifact(anchors[i], i);
        if (!artifact) continue;
        if (artifacts.some(existing => existing.name === artifact.name && existing.size === artifact.size)) continue;
        total += artifact.size;
        if (total > MAX_ARTIFACT_TOTAL_BYTES) break;
        artifacts.push(artifact);
      } catch (_) {
        // A failed artifact capture must not suppress the AI's text response.
      }
    }
    return artifacts;
  }

  function generationAppearsActive(node = latestResponseNode()) {
    if (firstVisible(adapter.stopSelectors)) return true;
    if (host === "gemini.google.com" && node) {
      const directStreaming = node.getAttribute?.("data-is-streaming") === "true"
        || node.getAttribute?.("aria-busy") === "true";
      if (directStreaming) return true;
      const nestedStreaming = node.querySelector?.(
        "[data-is-streaming='true'], [aria-busy='true'], mat-progress-spinner, mat-spinner, .loading-indicator"
      );
      if (nestedStreaming) return true;
    }
    return false;
  }

  async function monitor() {
    const node = latestResponseNode();
    const text = latestResponseText(node);
    if (!text || isResponseStub(text)) return;

    if (text !== lastObservedText) {
      lastObservedText = text;
      lastChangeAt = Date.now();
      return;
    }

    if (pendingSend) return;
    if (generationAppearsActive(node)) return;
    const stableMs = host === "gemini.google.com" ? 4200 : 2200;
    if (Date.now() - lastChangeAt < stableMs) return;

    const linkSignature = artifactAnchorSignature(node);
    const signature = `${text}\n::ARTIFACT_LINKS::${linkSignature}`;
    if (signature === lastReportedSignature || (text === lastReportedText && !linkSignature)) return;

    const artifacts = await captureArtifacts(node);
    lastReportedText = text;
    lastReportedSignature = signature;
    try {
      await chrome.runtime.sendMessage({ type: "AI_BRIDGE_RESPONSE", text, artifacts });
    } catch (_) {}
  }

  const observer = new MutationObserver(() => {});
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(monitor, 650);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "AI_BRIDGE_PING") {
      sendResponse({ ok: true, host: location.hostname, ready: true, version: "1.11.0" });
      return false;
    }


    if (msg.type === "AI_BRIDGE_NEW_CHAT") {
      openNewConversation()
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (msg.type === "AI_BRIDGE_SEND") {
      sendPrompt(String(msg.text || ""), Array.isArray(msg.artifacts) ? msg.artifacts : [])
        .then(uploadedCount => sendResponse({ ok: true, uploadedCount }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });
})();
