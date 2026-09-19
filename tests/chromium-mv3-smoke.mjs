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

if (!fs.existsSync(chromeBin)) throw new Error(`Chrome not found at ${chromeBin}`);
if (!process.env.DISPLAY) throw new Error("DISPLAY is not set; run this integration test under Xvfb.");

execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
  "-out", certPath, "-days", "1", "-subj", "/CN=chatgpt.com",
  "-addext", "subjectAltName=DNS:chatgpt.com"
], { stdio: "ignore" });

const pageHtml = `<!doctype html><html><body>
<textarea id="prompt-textarea"></textarea>
<button data-testid="send-button" aria-label="Send">Send</button>
<button data-testid="stop-button" aria-label="Stop" style="display:none">Stop</button>
<main id="conversation"></main>
<script>
window.__mockSendCount=0;
document.querySelector('[data-testid="send-button"]').addEventListener('click',()=>{
  window.__mockSendCount+=1;
  const prompt=document.querySelector('#prompt-textarea');
  const user=document.createElement('div');
  user.setAttribute('data-message-author-role','user');
  user.textContent=prompt.value;
  document.querySelector('#conversation').appendChild(user);
  prompt.value='';
  prompt.dispatchEvent(new Event('input',{bubbles:true}));
  const answer=document.createElement('div');
  answer.setAttribute('data-message-author-role','assistant');
  const markdown=document.createElement('div');
  markdown.className='markdown';
  markdown.textContent='mock assistant response '+window.__mockSendCount;
  answer.appendChild(markdown);
  document.querySelector('#conversation').appendChild(answer);
});
</script></body></html>`;

const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (req, res) => {
  if (req.url === "/mock" || req.url === "/mock/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(pageHtml);
  } else {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(mockPort, "127.0.0.1", resolve);
});

const mockUrl = `https://chatgpt.com:${mockPort}/mock`;
const chrome = spawn(chromeBin, [
  "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking",
  "--disable-component-update", "--disable-default-apps", "--disable-sync", "--no-first-run",
  "--ignore-certificate-errors", "--no-proxy-server", "--disable-features=OptimizationHints,MediaRouter",
  `--user-data-dir=${profileDir}`, `--remote-debugging-port=${remotePort}`,
  `--disable-extensions-except=${root}`, `--load-extension=${root}`,
  `--host-resolver-rules=MAP chatgpt.com 127.0.0.1,EXCLUDE localhost,EXCLUDE 127.0.0.1`,
  mockUrl
], { stdio: ["ignore", "pipe", "pipe"] });

let chromeStderr = "";
chrome.stderr.on("data", chunk => { chromeStderr += String(chunk); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(fn, { timeoutMs = 20000, intervalMs = 100, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
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
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message || "CDP command failed"));
    else item.resolve(message.result || {});
  });
  return {
    ready,
    async call(method, params = {}) {
      await ready;
      const id = nextId++;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() { try { socket.close(); } catch (_) {} }
  };
}

async function evaluate(client, expression) {
  const response = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Runtime.evaluate failed");
  return response.result?.value;
}

let workerClient = null;
let pageClient = null;
try {
  await eventually(() => jsonEndpoint("/json/version"), { label: "Chrome DevTools endpoint" });

  const targets = () => jsonEndpoint("/json/list");
  const pageTarget = await eventually(async () => {
    const list = await targets();
    return list.find(target => target.type === "page" && String(target.url).includes(`chatgpt.com:${mockPort}/mock`));
  }, { label: "mock provider page target" });
  pageClient = connectCdp(pageTarget.webSocketDebuggerUrl);
  await pageClient.ready;
  await pageClient.call("Runtime.enable");
  await eventually(async () => ["complete", "interactive"].includes(await evaluate(pageClient, "document.readyState")), { label: "mock provider DOM" });

  // A headed Chrome session under Xvfb exercises the extension-capable browser
  // path. Select the worker by AI Bridge's exact MV3 service-worker filename so
  // unrelated runner extensions cannot satisfy this test.
  const workerTarget = await eventually(async () => {
    const list = await targets();
    return list.find(target => target.type === "service_worker" && /^chrome-extension:\/\//.test(target.url) && target.url.endsWith("/background-wrapper.js"));
  }, { label: "AI Bridge background-wrapper.js service worker" });
  workerClient = connectCdp(workerTarget.webSocketDebuggerUrl);
  await workerClient.ready;
  await workerClient.call("Runtime.enable");

  const manifestVersion = await evaluate(workerClient, "chrome.runtime.getManifest().version");
  assert.equal(manifestVersion, "1.18.0");

  const tabLookup = `(await chrome.tabs.query({})).find(item=>String(item.url||'').includes('chatgpt.com:${mockPort}/mock'))`;
  const ping = await eventually(async () => evaluate(workerClient, `(async()=>{const tab=${tabLookup};if(!tab?.id)return null;try{return await chrome.tabs.sendMessage(tab.id,{type:'AI_BRIDGE_PING'});}catch(_){return null;}})()`), { label: "manifest content-script injection" });
  assert.equal(ping?.ok, true);
  assert.equal(ping?.runtimeVersion, "1.18.0");

  const sendExpr = `(async()=>{const tab=${tabLookup};return chrome.tabs.sendMessage(tab.id,{type:'AI_BRIDGE_SEND',text:'integration smoke prompt',artifacts:[],generationId:'integration-generation-1'});})()`;
  const first = await evaluate(workerClient, sendExpr);
  assert.equal(first?.ok, true);
  assert.equal(first?.sendAcknowledged, true);
  const duplicate = await evaluate(workerClient, sendExpr);
  assert.equal(duplicate?.ok, true);
  assert.equal(duplicate?.duplicateSend, true);

  await eventually(async () => (await evaluate(pageClient, "window.__mockSendCount")) === 1, { label: "exactly one provider DOM submission" });
  assert.equal(await evaluate(pageClient, "document.querySelector('#prompt-textarea').value"), "");
  assert.equal(await evaluate(pageClient, "document.querySelectorAll('[data-message-author-role=user]').length"), 1);
  assert.equal(await evaluate(pageClient, "document.querySelectorAll('[data-message-author-role=assistant]').length"), 1);
  console.log(`Chromium MV3 smoke passed (extension ${manifestVersion}, content runtime ${ping.runtimeVersion}).`);
} catch (error) {
  throw new Error(`${error.message}\nChrome stderr tail:\n${chromeStderr.slice(-5000)}`);
} finally {
  pageClient?.close();
  workerClient?.close();
  try { chrome.kill("SIGTERM"); } catch (_) {}
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(certDir, { recursive: true, force: true }); } catch (_) {}
}
