import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBin = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const remotePort = Number(process.env.AI_BRIDGE_CDP_PORT || 9222);
const mockPort = Number(process.env.AI_BRIDGE_MOCK_HTTPS_PORT || 8443);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-bridge-chrome-"));
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-bridge-cert-"));
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");

if (!fs.existsSync(chromeBin)) {
  throw new Error(`Chromium executable not found at ${chromeBin}. Set CHROME_BIN explicitly.`);
}

execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes",
  "-keyout", keyPath,
  "-out", certPath,
  "-days", "1",
  "-subj", "/CN=chatgpt.com",
  "-addext", "subjectAltName=DNS:chatgpt.com"
], { stdio: "ignore" });

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>AI Bridge mock provider</title></head>
<body>
  <textarea id="prompt-textarea" style="width:400px;height:100px"></textarea>
  <button data-testid="send-button" aria-label="Send">Send</button>
  <button data-testid="stop-button" aria-label="Stop" style="display:none">Stop</button>
  <main id="conversation"></main>
  <script>
    window.__mockSendCount = 0;
    document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
      window.__mockSendCount += 1;
      const answer = document.createElement('div');
      answer.setAttribute('data-message-author-role', 'assistant');
      const markdown = document.createElement('div');
      markdown.className = 'markdown';
      markdown.textContent = 'mock assistant response ' + window.__mockSendCount;
      answer.appendChild(markdown);
      document.querySelector('#conversation').appendChild(answer);
    });
  </script>
</body></html>`;

const server = https.createServer({
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
}, (req, res) => {
  if (req.url === "/mock" || req.url === "/mock/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(pageHtml);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(mockPort, "127.0.0.1", resolve);
});

const chrome = spawn(chromeBin, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--no-first-run",
  "--ignore-certificate-errors",
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${remotePort}`,
  `--disable-extensions-except=${root}`,
  `--load-extension=${root}`,
  `--host-resolver-rules=MAP chatgpt.com 127.0.0.1,EXCLUDE localhost,EXCLUDE 127.0.0.1`,
  "about:blank"
], { stdio: ["ignore", "pipe", "pipe"] });

let chromeStderr = "";
chrome.stderr.on("data", chunk => { chromeStderr += String(chunk); });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function eventually(fn, { timeoutMs = 15000, intervalMs = 100, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function jsonEndpoint(endpoint, options = {}) {
  const response = await fetch(`http://127.0.0.1:${remotePort}${endpoint}`, options);
  if (!response.ok) throw new Error(`CDP endpoint ${endpoint} returned HTTP ${response.status}`);
  return response.json();
}

function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed to open")), { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || "CDP command failed"));
    else resolve(message.result || {});
  });
  return {
    ready,
    async call(method, params = {}) {
      await ready;
      const id = nextId++;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return promise;
    },
    close() { try { socket.close(); } catch (_) {} }
  };
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

let workerClient = null;
let pageClient = null;
try {
  await eventually(() => jsonEndpoint("/json/version"), { label: "Chrome DevTools endpoint" });

  const workerTarget = await eventually(async () => {
    const targets = await jsonEndpoint("/json/list");
    return targets.find(target => target.type === "service_worker" && /^chrome-extension:\/\//.test(target.url));
  }, { label: "AI Bridge MV3 service worker" });

  workerClient = connectCdp(workerTarget.webSocketDebuggerUrl);
  await workerClient.ready;
  await workerClient.call("Runtime.enable");
  const manifestVersion = await evaluate(workerClient, "chrome.runtime.getManifest().version");
  assert.match(String(manifestVersion), /^\d+\.\d+\.\d+$/);

  const mockUrl = `https://chatgpt.com:${mockPort}/mock`;
  const pageTarget = await jsonEndpoint(`/json/new?${encodeURIComponent(mockUrl)}`, { method: "PUT" });
  pageClient = connectCdp(pageTarget.webSocketDebuggerUrl);
  await pageClient.ready;
  await pageClient.call("Runtime.enable");

  await eventually(async () => {
    const state = await evaluate(pageClient, "document.readyState");
    return state === "complete" || state === "interactive";
  }, { label: "mock provider DOM" });

  const ping = await eventually(async () => evaluate(workerClient, `(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => String(item.url || '').includes('chatgpt.com:${mockPort}/mock'));
    if (!tab?.id) return null;
    try { return await chrome.tabs.sendMessage(tab.id, { type: 'AI_BRIDGE_PING' }); }
    catch (_) { return null; }
  })()`), { label: "manifest content-script injection" });

  assert.equal(ping?.ok, true);
  assert.equal(ping?.runtimeVersion, "1.16.4");

  const first = await evaluate(workerClient, `(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => String(item.url || '').includes('chatgpt.com:${mockPort}/mock'));
    return chrome.tabs.sendMessage(tab.id, {
      type: 'AI_BRIDGE_SEND',
      text: 'integration smoke prompt',
      artifacts: [],
      generationId: 'integration-generation-1'
    });
  })()`);
  assert.equal(first?.ok, true);

  const duplicate = await evaluate(workerClient, `(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => String(item.url || '').includes('chatgpt.com:${mockPort}/mock'));
    return chrome.tabs.sendMessage(tab.id, {
      type: 'AI_BRIDGE_SEND',
      text: 'integration smoke prompt',
      artifacts: [],
      generationId: 'integration-generation-1'
    });
  })()`);
  assert.equal(duplicate?.ok, true);
  assert.equal(duplicate?.duplicateSend, true);

  await eventually(async () => (await evaluate(pageClient, "window.__mockSendCount")) === 1, {
    label: "exactly one provider DOM submission"
  });
  assert.equal(await evaluate(pageClient, "document.querySelector('#prompt-textarea').value"), "integration smoke prompt");
  assert.equal(await evaluate(pageClient, "document.querySelectorAll('[data-message-author-role=assistant]').length"), 1);

  console.log(`Chromium MV3 smoke passed (extension ${manifestVersion}, content runtime ${ping.runtimeVersion}).`);
} catch (error) {
  const stderrTail = chromeStderr.slice(-4000);
  throw new Error(`${error.message}\nChrome stderr tail:\n${stderrTail}`);
} finally {
  pageClient?.close();
  workerClient?.close();
  try { chrome.kill("SIGTERM"); } catch (_) {}
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(certDir, { recursive: true, force: true }); } catch (_) {}
}
