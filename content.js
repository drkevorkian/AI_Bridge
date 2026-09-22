(() => {
  const RUNTIME_KEY = "__AI_BRIDGE_CONTENT_RUNTIME_V118__";
  const residentRuntime = globalThis[RUNTIME_KEY];
  if (residentRuntime && typeof residentRuntime.dispose === "function") {
    try { residentRuntime.dispose("reinjected"); } catch (_) {}
  }
  // Retain the legacy marker for compatibility, but never use it as proof that
  // the extension context is still alive. Unpacked-extension reloads invalidate
  // chrome.runtime while page globals can survive long enough to fool a boolean guard.
  window.__AI_BRIDGE_LOADED_V113__ = true;

  const host = location.hostname;
  let lastObservedText = "";
  let lastChangeAt = 0;
  let lastReportedText = "";
  let lastReportedSignature = "";
  let lastObservedNode = null;
  let pendingSend = false;
  let pendingResponseDelivery = null;
  let responseDeliveryInFlight = false;
  let monitorInFlight = false;
  let awaitingResponseBaselineNode = null;
  let awaitingResponseBaselineText = "";
  let disposed = false;
  let monitorInterval = null;
  let observer = null;
  const MAX_ARTIFACTS_PER_RESPONSE = 8;
  const MAX_ARTIFACT_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_ARTIFACT_TOTAL_BYTES = 24 * 1024 * 1024;
  const ARTIFACT_FETCH_TIMEOUT_MS = 15000;
  const DOWNLOAD_CANDIDATE_SELECTOR = [
    "a[href]", "a[download]", "button", "[role='button']",
    "[data-download-url]", "[data-file-url]", "[data-url]", "[data-href]"
  ].join(",");

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

  const domResilience = globalThis.AIBridgeDomResilience || null;
  const providerKey = domResilience?.providerFromHost?.(host) || null;

  function domHealthSnapshot() {
    if (!domResilience || !providerKey) return null;
    try {
      return domResilience.healthSnapshot(
        providerKey,
        selector => document.querySelectorAll(selector),
        getComputedStyle
      );
    } catch (_) {
      return null;
    }
  }

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

  function extensionContextInvalidated(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  async function runtimeSendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (extensionContextInvalidated(error)) {
        try { disposeContentRuntime("extension-context-invalidated"); } catch (_) {}
      }
      throw error;
    }
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

  function actionableSendControl(node) {
    if (!node || node.isConnected === false || node.disabled === true || node.getAttribute?.("aria-disabled") === "true") return false;
    const rect = node.getBoundingClientRect?.();
    const style = getComputedStyle(node);
    return Boolean(rect && rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none");
  }

  function firstActionableSendControl(selectors) {
    for (const selector of selectors || []) {
      let nodes = [];
      try { nodes = [...document.querySelectorAll(selector)]; } catch (_) {}
      for (const node of nodes) {
        if (actionableSendControl(node)) return node;
      }
    }
    return null;
  }

  async function resolveSendAction(input) {
    for (let i = 0; i < 40; i++) {
      const button = firstActionableSendControl(adapter.sendSelectors);
      if (button) return { kind: "button", node: button, form: null };
      await sleep(100);
    }

    // Narrow structural fallback: only the exact form containing the verified
    // composer can gain submit authority. Never synthesize Enter on the page.
    const form = input?.closest?.("form") || null;
    if (!form) return null;
    const submitters = [...form.querySelectorAll("button[type='submit'],input[type='submit']")]
      .filter(actionableSendControl);
    if (submitters.length === 1) return { kind: "button", node: submitters[0], form };
    if (submitters.length === 0 && typeof form.requestSubmit === "function") {
      return { kind: "requestSubmit", node: null, form };
    }
    return null;
  }

  async function sendPrompt(text, artifacts = []) {
    const input = firstVisible(adapter.inputSelectors);
    if (!input) throw new Error("Could not find the prompt box on this page.");

    const baselineNode = latestResponseNode();
    awaitingResponseBaselineNode = baselineNode;
    awaitingResponseBaselineText = latestResponseText(baselineNode);
    pendingSend = true;

    try {
      const uploadedCount = await uploadArtifacts(artifacts);
      setNativeValue(input, text);
      await sleep(uploadedCount ? 650 : 300);

      const sendAction = await resolveSendAction(input);
      if (!sendAction) {
        throw new Error("Could not prove an actionable Send control for this AI page.");
      }

      if (sendAction.kind === "button") sendAction.node.click();
      else sendAction.form.requestSubmit();

      // A fresh prompt may legitimately produce the same wording as the
      // previous response. Clear report de-duplication only after a real send
      // action was proven and invoked.
      lastReportedText = "";
      lastReportedSignature = "";
      lastObservedText = "";
      lastObservedNode = null;
      lastChangeAt = Date.now();
      setTimeout(() => {
        if (!disposed) pendingSend = false;
      }, uploadedCount ? 2200 : 1200);
      return uploadedCount;
    } catch (error) {
      pendingSend = false;
      throw error;
    }
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
    const primary = node?.closest?.("[data-message-author-role='assistant'], [data-message-id], article, model-response") || node;
    if (!primary) return node;
    if (primary.querySelector?.(DOWNLOAD_CANDIDATE_SELECTOR)) return primary;
    // Some providers render a file card as a sibling of the textual response.
    // Look one message-wrapper level up, but never scan the whole conversation.
    const parent = primary.parentElement;
    if (parent && parent !== document.body && parent.querySelector?.(DOWNLOAD_CANDIDATE_SELECTOR)) return parent;
    return primary;
  }

  function candidateLinks(node) {
    const links = [];
    if (!node) return links;
    if (node.matches?.("a[href], a[download]")) links.push(node);
    const parent = node.closest?.("a[href], a[download]");
    if (parent && parent !== node) links.push(parent);
    const child = node.querySelector?.("a[href], a[download]");
    if (child && child !== node) links.push(child);
    return links;
  }

  function datasetUrls(node) {
    const urls = [];
    for (const value of Object.values(node?.dataset || {})) {
      const candidate = String(value || "").trim();
      if (/^(https?:|blob:|data:|sandbox:)/i.test(candidate)) urls.push(candidate);
    }
    return urls;
  }

  function rawCandidateUrls(node) {
    const values = [];
    const add = value => {
      const candidate = String(value || "").trim();
      if (candidate && !values.includes(candidate)) values.push(candidate);
    };
    add(node?.getAttribute?.("href"));
    add(node?.href);
    for (const attr of ["data-download-url", "data-file-url", "data-url", "data-href"]) add(node?.getAttribute?.(attr));
    for (const value of datasetUrls(node)) add(value);
    for (const link of candidateLinks(node)) {
      add(link.getAttribute?.("href"));
      add(link.href);
      for (const value of datasetUrls(link)) add(value);
    }
    return values;
  }

  function looksLikeDownload(node) {
    const text = String(node?.textContent || "").trim();
    const aria = String(node?.getAttribute?.("aria-label") || "");
    const title = String(node?.getAttribute?.("title") || "");
    const testId = String(node?.getAttribute?.("data-testid") || "");
    const role = String(node?.getAttribute?.("role") || "");
    const className = typeof node?.className === "string" ? node.className : "";
    const urls = rawCandidateUrls(node).join(" ");
    const label = `${text} ${aria} ${title} ${testId} ${role} ${className}`;
    return Boolean(
      node?.hasAttribute?.("download") ||
      /(?:^|\s)(?:blob:|data:|sandbox:)/i.test(urls) ||
      /\b(download|attachment|artifact|file|rendered file|save file)\b/i.test(label) ||
      /\/(?:interpreter\/)?download(?:[/?#]|$)/i.test(urls) ||
      /\.(?:zip|7z|tar|tgz|gz|bz2|xz|rar|py|js|ts|tsx|jsx|json|txt|md|csv|pdf|docx|xlsx|pptx)(?:$|[?#\s])/i.test(`${urls} ${text}`)
    );
  }

  function chatGptSandboxUrl(node, sandboxHref) {
    if (!(host === "chatgpt.com" || host === "chat.openai.com")) return "";
    const sandboxPath = String(sandboxHref || "").replace(/^sandbox:/i, "");
    if (!sandboxPath.startsWith("/mnt/data/")) return "";
    const conversationMatch = location.pathname.match(/(?:^|\/)c\/([^/?#]+)/);
    const messageNode = node?.closest?.("[data-message-id]") || artifactRoot(node);
    const messageId = messageNode?.getAttribute?.("data-message-id") || messageNode?.dataset?.messageId || "";
    if (!conversationMatch?.[1] || !messageId) return "";
    return `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationMatch[1])}/interpreter/download?message_id=${encodeURIComponent(messageId)}&sandbox_path=${encodeURIComponent(sandboxPath)}`;
  }

  function artifactUrl(node) {
    const candidates = rawCandidateUrls(node);
    for (const candidate of candidates) {
      if (/^(https?:|blob:|data:)/i.test(candidate)) return candidate;
      if (/^sandbox:/i.test(candidate)) {
        const translated = chatGptSandboxUrl(node, candidate);
        if (translated) return translated;
      }
    }
    return "";
  }

  function downloadCandidates(root) {
    const nodes = [...(root?.querySelectorAll?.(DOWNLOAD_CANDIDATE_SELECTOR) || [])];
    const out = [];
    const seen = new Set();
    for (const node of nodes) {
      if (!looksLikeDownload(node)) continue;
      const url = artifactUrl(node);
      const key = url || `${node.tagName || "node"}|${String(node.textContent || "").trim()}|${String(node.getAttribute?.("aria-label") || "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(node);
      if (out.length >= MAX_ARTIFACTS_PER_RESPONSE) break;
    }
    return out;
  }

  function artifactName(node, url, index) {
    const explicit = String(node?.getAttribute?.("download") || "").trim();
    if (explicit) return explicit.slice(0, 240);
    try {
      const parsed = new URL(url, location.href);
      const sandboxPath = parsed.searchParams.get("sandbox_path");
      const path = sandboxPath || decodeURIComponent(parsed.pathname || "");
      const name = path.split("/").filter(Boolean).pop();
      if (name) return name.slice(0, 240);
    } catch (_) {}
    const text = String(node?.textContent || "").trim();
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

  async function fetchArtifact(node, index) {
    const url = artifactUrl(node);
    if (!url) throw new Error("download control has no resolvable URL");
    const name = artifactName(node, url, index);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARTIFACT_FETCH_TIMEOUT_MS);
    let localError = null;
    try {
      try {
        const response = await fetch(url, { credentials: "include", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const declared = Number(response.headers.get("content-length") || 0);
        if (declared > MAX_ARTIFACT_FILE_BYTES) throw new Error("file too large");
        const blob = await response.blob();
        if (blob.size <= 0 || blob.size > MAX_ARTIFACT_FILE_BYTES) throw new Error("file too large or empty");
        return {
          name,
          mime: blob.type || response.headers.get("content-type") || "application/octet-stream",
          size: blob.size,
          dataBase64: await blobToBase64(blob)
        };
      } catch (err) {
        localError = err;
      }
    } finally {
      clearTimeout(timer);
    }

    // Page-context fetch can be blocked by CORS even though the extension has
    // permission to retrieve the file. Retry HTTP(S) downloads in the service worker.
    if (/^https?:/i.test(url)) {
      const remote = await runtimeSendMessage({
        type: "AI_BRIDGE_FETCH_ARTIFACT",
        url,
        name,
        mime: ""
      });
      if (remote?.ok && remote.artifact?.dataBase64) return remote.artifact;
      throw new Error(remote?.error || localError?.message || "artifact fetch failed");
    }
    throw localError || new Error("artifact fetch failed");
  }

  function artifactCandidateSignature(node) {
    const root = artifactRoot(node);
    const candidates = downloadCandidates(root);
    return candidates.map((candidate, index) => {
      const url = artifactUrl(candidate);
      return `${url}|${artifactName(candidate, url, index)}`;
    }).join("||");
  }

  async function captureArtifacts(node) {
    const root = artifactRoot(node);
    const candidates = downloadCandidates(root);
    const artifacts = [];
    const errors = [];
    let total = 0;
    for (let i = 0; i < candidates.length; i++) {
      try {
        const artifact = await fetchArtifact(candidates[i], i);
        if (!artifact) continue;
        if (artifacts.some(existing => existing.name === artifact.name && existing.size === artifact.size)) continue;
        total += artifact.size;
        if (total > MAX_ARTIFACT_TOTAL_BYTES) {
          errors.push("combined artifact relay limit reached");
          break;
        }
        artifacts.push(artifact);
      } catch (err) {
        const label = String(candidates[i]?.textContent || candidates[i]?.getAttribute?.("aria-label") || `candidate ${i + 1}`).trim().slice(0, 120);
        errors.push(`${label || `candidate ${i + 1}`}: ${err?.message || "capture failed"}`);
      }
    }
    return { artifacts, errors, candidateCount: candidates.length };
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

  async function deliverPendingResponse() {
    if (disposed || responseDeliveryInFlight || !pendingResponseDelivery) return;
    const pending = pendingResponseDelivery;
    responseDeliveryInFlight = true;
    try {
      await runtimeSendMessage(pending.envelope);
      if (disposed || pendingResponseDelivery !== pending) return;
      lastReportedText = pending.text;
      lastReportedSignature = pending.signature;
      pendingResponseDelivery = null;
    } catch (_) {
      // Keep the envelope pending. The regular monitor tick retries transient
      // worker/message failures. An invalidated context disposes this runtime.
    } finally {
      responseDeliveryInFlight = false;
    }
  }

  async function monitor() {
    if (disposed) return;
    if (pendingResponseDelivery) {
      await deliverPendingResponse();
      return;
    }

    const node = latestResponseNode();
    const text = latestResponseText(node);
    if (!text || isResponseStub(text)) return;

    if (
      awaitingResponseBaselineNode &&
      node === awaitingResponseBaselineNode &&
      text === awaitingResponseBaselineText
    ) {
      return;
    }

    if (text !== lastObservedText || node !== lastObservedNode) {
      lastObservedText = text;
      lastObservedNode = node;
      lastChangeAt = Date.now();
      if (
        node !== awaitingResponseBaselineNode ||
        text !== awaitingResponseBaselineText
      ) {
        awaitingResponseBaselineNode = null;
        awaitingResponseBaselineText = "";
      }
      return;
    }

    if (pendingSend) return;
    if (generationAppearsActive(node)) return;
    const stableMs = host === "gemini.google.com" ? 4200 : 2200;
    if (Date.now() - lastChangeAt < stableMs) return;

    const linkSignature = artifactCandidateSignature(node);
    const signature = `${text}\n::ARTIFACT_LINKS::${linkSignature}`;
    if (signature === lastReportedSignature || (text === lastReportedText && !linkSignature)) return;

    const completedAt = Number(lastChangeAt) || Date.now();
    const captured = await captureArtifacts(node);
    pendingResponseDelivery = Object.freeze({
      text,
      signature,
      envelope: Object.freeze({
        type: "AI_BRIDGE_RESPONSE",
        text,
        artifacts: captured.artifacts,
        artifactDiagnostics: { candidateCount: captured.candidateCount, errors: captured.errors },
        completedAt
      })
    });
    await deliverPendingResponse();
  }

  async function runMonitor() {
    if (disposed || monitorInFlight) return;
    monitorInFlight = true;
    try { await monitor(); }
    finally { monitorInFlight = false; }
  }

  observer = new MutationObserver(() => {
    runMonitor().catch(() => {});
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  monitorInterval = setInterval(() => {
    runMonitor().catch(() => {});
  }, 650);

  const onRuntimeMessage = (msg, _sender, sendResponse) => {
    if (msg.type === "AI_BRIDGE_PING") {
      sendResponse({
        ok: true,
        host: location.hostname,
        ready: true,
        version: "1.18.1",
        domHealth: domHealthSnapshot()
      });
      return false;
    }

    if (msg.type === "AI_BRIDGE_DOM_HEALTH") {
      sendResponse({
        ok: true,
        host: location.hostname,
        provider: providerKey,
        domHealth: domHealthSnapshot()
      });
      return false;
    }

    if (msg.type === "AI_BRIDGE_READ_LAST_RESPONSE") {
      try {
        const node = latestResponseNode();
        const text = latestResponseText(node);
        sendResponse({
          ok: Boolean(text),
          text,
          active: generationAppearsActive(node),
          host: location.hostname
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
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
    return false;
  };

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  function disposeContentRuntime(reason = "disposed") {
    if (disposed) return;
    disposed = true;
    try { observer?.disconnect(); } catch (_) {}
    if (monitorInterval !== null) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
    pendingResponseDelivery = null;
    responseDeliveryInFlight = false;
    monitorInFlight = false;
    pendingSend = false;
    awaitingResponseBaselineNode = null;
    awaitingResponseBaselineText = "";
    const current = globalThis[RUNTIME_KEY];
    if (current && current.dispose === disposeContentRuntime) {
      current.active = false;
      current.disposedReason = String(reason || "disposed").slice(0, 80);
    }
  }

  globalThis[RUNTIME_KEY] = {
    build: "1.18.1",
    active: true,
    installedAt: Date.now(),
    dispose: disposeContentRuntime
  };
})();
