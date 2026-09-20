'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
  throw new Error('AI Bridge Chrome E2E requires Node.js 22+ (global WebSocket and fetch).');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function chromeBinary() {
  const candidates = process.platform === 'win32'
    ? [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
    : process.platform === 'darwin'
      ? [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error('Chrome/Chromium not found. Set CHROME_BIN.');
}

class PipeCdp {
  constructor(proc) {
    this.proc = proc;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = Buffer.alloc(0);
    const input = proc.stdio[3];
    const output = proc.stdio[4];
    if (!input || !output) throw new Error('Chrome remote-debugging-pipe file descriptors are unavailable.');
    this.input = input;
    output.on('data', chunk => this.onData(chunk));
    output.on('error', error => this.rejectAll(error));
    proc.on('exit', (code, signal) => this.rejectAll(new Error('Chrome exited: ' + code + '/' + signal)));
  }

  rejectAll(error) {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const nul = this.buffer.indexOf(0);
      if (nul < 0) break;
      const raw = this.buffer.subarray(0, nul).toString('utf8');
      this.buffer = this.buffer.subarray(nul + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          const detail = message.error.message || JSON.stringify(message.error);
          const params = pending.params && Object.keys(pending.params).length ? ' params=' + JSON.stringify(pending.params) : '';
          pending.reject(new Error('CDP ' + pending.method + ' failed: ' + detail + params));
        } else pending.resolve(message.result || {});
        continue;
      }
      for (const listener of [...this.listeners]) {
        if (listener.method !== message.method) continue;
        if (listener.sessionId != null && listener.sessionId !== message.sessionId) continue;
        if (listener.predicate && !listener.predicate(message.params || {}, message)) continue;
        listener.resolve({ params: message.params || {}, message });
        if (listener.once) this.listeners.delete(listener);
      }
    }
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 10000) {
    const id = ++this.nextId;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        params,
        resolve: result => { clearTimeout(timer); resolve(result); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
    });
    this.input.write(JSON.stringify(message) + '\0');
    return promise;
  }

  on(method, handler, sessionId = null) {
    const listener = {
      method,
      sessionId,
      once: false,
      predicate: null,
      resolve: event => Promise.resolve(handler(event.params, event.message)).catch(() => {})
    };
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

async function poll(fn, predicate = value => Boolean(value), timeoutMs = 10000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (predicate(last)) return last;
    } catch (error) {
      last = error;
    }
    await sleep(intervalMs);
  }
  throw new Error('Poll timeout. Last value: ' + (last instanceof Error ? last.message : JSON.stringify(last)));
}

async function attach(cdp, targetId) {
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, attached.sessionId);
  await cdp.send('Page.enable', {}, attached.sessionId);
  return attached.sessionId;
}

async function evaluate(cdp, sessionId, expression, awaitPromise = true) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  }, sessionId, 15000);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.value;
}

async function assertPausedDashboard(cdp, page, reasonPattern, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  assert.ok(reasonPattern instanceof RegExp, 'reasonPattern must be a RegExp');
  const state = await poll(
    async () => evaluate(
      cdp,
      page.sessionId,
      '({pill:document.getElementById("sessionPill")?.textContent||"",status:document.getElementById("status")?.textContent||""})'
    ),
    value =>
      /^Paused$/i.test(String(value?.pill || '').trim()) &&
      /Runtime:\s*Paused/i.test(String(value?.status || '')) &&
      reasonPattern.test(String(value?.status || '')),
    timeoutMs,
    intervalMs
  );

  assert.match(String(state.pill || '').trim(), /^Paused$/i);
  assert.match(String(state.status || ''), /Runtime:\s*Paused/i);
  assert.match(String(state.status || ''), reasonPattern);
  assert.doesNotMatch(String(state.status || ''), /Running\s*[—-]\s*Relay/i);
  assert.doesNotMatch(String(state.status || ''), /Recovering next relay turn/i);
  assert.doesNotMatch(String(state.status || ''), /Runtime:\s*Awaiting provider response/i);
  return state;
}

async function assertRunningAwaitingDashboard(cdp, page, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const state = await poll(
    async () => evaluate(
      cdp,
      page.sessionId,
      '({pill:document.getElementById("sessionPill")?.textContent||"",status:document.getElementById("status")?.textContent||""})'
    ),
    value =>
      /^Running$/i.test(String(value?.pill || '').trim()) &&
      /Runtime:\s*Awaiting provider response/i.test(String(value?.status || '')) &&
      !/Runtime:\s*Paused/i.test(String(value?.status || '')),
    timeoutMs,
    intervalMs
  );

  assert.match(String(state.pill || '').trim(), /^Running$/i);
  assert.match(String(state.status || ''), /Runtime:\s*Awaiting provider response/i);
  assert.doesNotMatch(String(state.status || ''), /Runtime:\s*Paused/i);
  return state;
}

async function extensionMessage(cdp, sessionId, message) {
  const expression =
    '(async()=>{try{return {transportOk:true,value:await chrome.runtime.sendMessage(' +
    JSON.stringify(message) +
    ')};}catch(error){return {transportOk:false,error:error?.message||String(error)}}})()';
  return evaluate(cdp, sessionId, expression, true);
}

let defaultBrowserContextResolved = false;
let defaultBrowserContextId = null;

async function createTarget(cdp, url) {
  if (!defaultBrowserContextResolved) {
    defaultBrowserContextResolved = true;
    try {
      const contexts = await cdp.send('Target.getBrowserContexts');
      defaultBrowserContextId = contexts.defaultBrowserContextId || null;
    } catch (_) {
      defaultBrowserContextId = null;
    }
  }
  const params = { url };
  if (defaultBrowserContextId) params.browserContextId = defaultBrowserContextId;
  return cdp.send('Target.createTarget', params);
}

async function createExtensionPage(cdp, extensionId, pageName) {
  const created = await createTarget(cdp, 'chrome-extension://' + extensionId + '/' + pageName);
  const sessionId = await attach(cdp, created.targetId);
  await poll(() => evaluate(cdp, sessionId, 'document.readyState'), value => value === 'complete' || value === 'interactive', 10000);
  return { targetId: created.targetId, sessionId };
}

const fixtureHtml = '<!doctype html><html><head><meta charset="utf-8"><title>AI Bridge E2E ChatGPT Fixture</title></head><body>' +
  '<textarea id="prompt-textarea"></textarea>' +
  '<button data-testid="send-button" aria-label="Send prompt">Send</button>' +
  '<main id="messages"></main>' +
  '<script>' +
  'window.__providerActionCount=0;window.__autoConfirm=false;window.__emitResponse=true;window.__lastPrompt="";' +
  'const composer=document.getElementById("prompt-textarea");' +
  'const send=document.querySelector("[data-testid=\\"send-button\\"]");' +
  'send.addEventListener("click",()=>{window.__providerActionCount+=1;window.__lastPrompt=composer.value;' +
  'if(!window.__autoConfirm)return;composer.value="";composer.dispatchEvent(new Event("input",{bubbles:true}));' +
  'if(!window.__emitResponse)return;' +
  'setTimeout(()=>{const wrap=document.createElement("div");wrap.setAttribute("data-message-author-role","assistant");' +
  'const body=document.createElement("div");body.className="markdown";body.textContent="E2E fixture response "+window.__providerActionCount;' +
  'wrap.appendChild(body);document.getElementById("messages").appendChild(wrap);},50);});' +
  '</script></body></html>';

async function createProviderFixture(cdp, url) {
  const created = await createTarget(cdp, 'about:blank');
  const sessionId = await attach(cdp, created.targetId);
  const dispose = cdp.on('Fetch.requestPaused', async params => {
    if (params.resourceType !== 'Document') {
      await cdp.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
      return;
    }
    await cdp.send('Fetch.fulfillRequest', {
      requestId: params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'text/html; charset=utf-8' },
        { name: 'Cache-Control', value: 'no-store' }
      ],
      body: Buffer.from(fixtureHtml, 'utf8').toString('base64')
    }, sessionId);
  }, sessionId);
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }]
  }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await poll(() => evaluate(cdp, sessionId, 'document.readyState'), value => value === 'complete', 10000);
  return { targetId: created.targetId, sessionId, dispose };
}

async function extensionStorage(cdp, extensionId, keys) {
  const result = await cdp.send('Extensions.getStorageItems', { id: extensionId, storageArea: 'local', keys });
  return result.data || {};
}

async function setExtensionStorage(cdp, extensionId, values) {
  await cdp.send('Extensions.setStorageItems', { id: extensionId, storageArea: 'local', values });
}

async function workerTarget(cdp, extensionId) {
  const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
  return targets.find(target =>
    target.type === 'service_worker' &&
    target.url === 'chrome-extension://' + extensionId + '/background.js'
  ) || null;
}

async function main() {
  const runtimeDir = path.resolve(__dirname, '..', 'runtime_review');
  assert.ok(fs.existsSync(path.join(runtimeDir, 'manifest.json')), 'runtime_review manifest missing');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-chrome-e2e-'));
  const chrome = chromeBinary();
  const args = [
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    '--headless=new',
    '--user-data-dir=' + profile,
    'about:blank'
  ];
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');

  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let chromeStderr = '';
  proc.stderr.on('data', chunk => { chromeStderr += chunk.toString(); });
  const cdp = new PipeCdp(proc);
  const pages = [];

  try {
    const version = await cdp.send('Browser.getVersion');
    console.log('Chrome:', version.product);

    let extensionId;
    try {
      extensionId = (await cdp.send('Extensions.loadUnpacked', { path: runtimeDir }, undefined, 20000)).id;
    } catch (error) {
      throw new Error(
        'Chrome could not install AI_OUTPUT/runtime_review as unpacked. The E2E gate cannot pass without a real extension installation. ' +
        error.message +
        (chromeStderr ? '\nChrome stderr:\n' + chromeStderr.slice(-4000) : '')
      );
    }
    assert.match(extensionId, /^[a-p]{32}$/i, 'Extensions.loadUnpacked returned an invalid extension ID');

    const popup = await createExtensionPage(cdp, extensionId, 'popup.html');
    pages.push(popup);
    assert.match(await evaluate(cdp, popup.sessionId, 'document.body.innerText'), /AI Bridge/i);

    const settings = await createExtensionPage(cdp, extensionId, 'settings.html');
    pages.push(settings);
    assert.match(await evaluate(cdp, settings.sessionId, 'document.body.innerText'), /Settings/i);

    // Popup polls AI_BRIDGE_GET_STATE every 900 ms. Leaving it open would wake
    // the MV3 worker during fault injection and race storage seeding. Settings
    // is also closed after smoke validation so only the scenario Dashboard may
    // intentionally wake the worker after each stopAllWorkers() call.
    for (const page of [popup, settings]) {
      await cdp.send('Target.closeTarget', { targetId: page.targetId });
      const pageIndex = pages.indexOf(page);
      if (pageIndex >= 0) pages.splice(pageIndex, 1);
    }

    const dashboard = await createExtensionPage(cdp, extensionId, 'dashboard.html');
    pages.push(dashboard);
    assert.match(await evaluate(cdp, dashboard.sessionId, 'document.body.innerText'), /New chat — Limited/i);
    assert.equal(await evaluate(cdp, dashboard.sessionId, 'document.getElementById("newChatA").disabled'), true);
    assert.equal(await evaluate(cdp, dashboard.sessionId, 'document.getElementById("freshOnStart").disabled'), true);

    const providerA = await createProviderFixture(cdp, 'https://chatgpt.com/c/e2e-a');
    const providerB = await createProviderFixture(cdp, 'https://chatgpt.com/c/e2e-b');
    pages.push(providerA, providerB);

    const providerTabs = await poll(async () => {
      const tabs = await evaluate(cdp, dashboard.sessionId, '(async()=>await chrome.tabs.query({}))()');
      const a = tabs.find(tab => tab.url === 'https://chatgpt.com/c/e2e-a');
      const b = tabs.find(tab => tab.url === 'https://chatgpt.com/c/e2e-b');
      return a && b ? { a: a.id, b: b.id } : null;
    }, Boolean, 10000);

    await poll(async () => {
      const health = await extensionMessage(cdp, dashboard.sessionId, { type: 'AI_BRIDGE_PROVIDER_HEALTH', tabId: providerTabs.a });
      return health.transportOk && health.value?.connectionStatus === 'CONNECTED';
    }, Boolean, 10000);

    await evaluate(cdp, providerA.sessionId, 'window.__autoConfirm=false;true');

    const startMessage = {
      type: 'AI_BRIDGE_START',
      agentCount: 2,
      startSide: 'A',
      workMode: 'relay',
      maxTurns: 4,
      delayMs: 0,
      initialPrompt: 'AI Bridge real-Chrome E2E ambiguous-delivery fault test.',
      teamRules: '',
      sourceFiles: [],
      freshChats: false,
      tabA: providerTabs.a,
      tabB: providerTabs.b,
      labelA: 'Fixture ChatGPT A',
      labelB: 'Fixture ChatGPT B',
      jobA: 'E2E fixture A',
      jobB: 'E2E fixture B'
    };
    const startExpression =
      '(()=>{window.__aiBridgeE2EStart={done:false,value:null,error:null};chrome.runtime.sendMessage(' +
      JSON.stringify(startMessage) +
      ').then(value=>{window.__aiBridgeE2EStart={done:true,value,error:null};})' +
      '.catch(error=>{window.__aiBridgeE2EStart={done:true,value:null,error:error?.message||String(error)};});return true;})()';
    await evaluate(cdp, dashboard.sessionId, startExpression, false);

    await poll(async () => {
      const actionCount = await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount');
      if (actionCount === 1) return true;

      const startState = await evaluate(cdp, dashboard.sessionId, 'window.__aiBridgeE2EStart');
      if (startState?.done && startState?.error) {
        const stored = await extensionStorage(cdp, extensionId, ['aiBridgeRuntimeDispatchLedger', 'bridgeState', 'aiBridgeRuntimeAuthorityEpochs']);
        throw new Error(
          'Initial AI_BRIDGE_START failed before provider action. ' +
          'error=' + startState.error +
          ' state=' + JSON.stringify(stored)
        );
      }
      if (startState?.done && startState?.value?.ok === false) {
        throw new Error(
          'Initial AI_BRIDGE_START returned a failure before provider action: ' +
          JSON.stringify(startState.value)
        );
      }
      return false;
    }, Boolean, 15000);

    const healthBeforeKill = await poll(async () => {
      const health = await extensionMessage(cdp, dashboard.sessionId, { type: 'AI_BRIDGE_PROVIDER_HEALTH', tabId: providerTabs.a });
      if (!health.transportOk || !health.value?.ok) return null;
      return health.value;
    }, value =>
      value?.connectionStatus === 'CONNECTED' &&
      value?.actionAuthorityStatus === 'DOCUMENT_AUTHORITY_VERIFIED' &&
      value?.capabilities?.relay === 'READY',
    10000);
    assert.equal(healthBeforeKill.capabilities.rollover, 'LIMITED');
    assert.equal(healthBeforeKill.capabilities.artifacts, 'LIMITED');

    const beforeKill = await extensionStorage(cdp, extensionId, ['aiBridgeRuntimeDispatchLedger', 'bridgeState']);
    const recordsBeforeKill = beforeKill.aiBridgeRuntimeDispatchLedger?.records || [];
    assert.equal(recordsBeforeKill.length, 1);
    assert.equal(recordsBeforeKill[0].status, 'DISPATCHING');
    const responseCountBeforeKill = (beforeKill.bridgeState?.transcript || []).filter(entry => entry?.type === 'response').length;
    assert.equal(responseCountBeforeKill, 0, 'Provider-click/ACK-loss setup should not commit a response before the worker kill');

    await cdp.send('Target.closeTarget', { targetId: dashboard.targetId });
    const dashboardIndex = pages.indexOf(dashboard);
    if (dashboardIndex >= 0) pages.splice(dashboardIndex, 1);

    await cdp.send('ServiceWorker.stopAllWorkers');
    await poll(() => workerTarget(cdp, extensionId), value => value === null, 10000);

    const dashboardAfter = await createExtensionPage(cdp, extensionId, 'dashboard.html');
    pages.push(dashboardAfter);

    const recoveredState = await poll(async () => {
      const response = await extensionMessage(cdp, dashboardAfter.sessionId, { type: 'AI_BRIDGE_GET_STATE', omitTranscript: true });
      return response.transportOk ? response.value?.state : null;
    }, state => state?.paused === true && state?.runtimePhase === 'PAUSED', 15000);

    assert.equal(recoveredState.running, false);
    assert.match(recoveredState.pauseReason || '', /ambiguous|interrupted|replay/i);

    const healthAfterRestart = await poll(async () => {
      const health = await extensionMessage(cdp, dashboardAfter.sessionId, { type: 'AI_BRIDGE_PROVIDER_HEALTH', tabId: providerTabs.a });
      if (!health.transportOk || !health.value?.ok) return null;
      return health.value;
    }, value =>
      value?.connectionStatus === 'CONNECTED' &&
      value?.actionAuthorityStatus === 'DOCUMENT_AUTHORITY_VERIFIED' &&
      value?.capabilities?.relay === 'READY',
    15000);
    assert.equal(healthAfterRestart.capabilities.rollover, 'LIMITED');
    assert.equal(healthAfterRestart.capabilities.artifacts, 'LIMITED');

    const pausedAfterHealth = await extensionMessage(cdp, dashboardAfter.sessionId, { type: 'AI_BRIDGE_GET_STATE', omitTranscript: false });
    assert.equal(pausedAfterHealth.transportOk, true);
    assert.equal(pausedAfterHealth.value?.state?.paused, true, 'Provider re-verification must not clear the session pause');
    assert.equal(pausedAfterHealth.value?.state?.running, false, 'Provider re-verification must not resume the session');
    const responseCountAfterRestart = (pausedAfterHealth.value?.state?.transcript || []).filter(entry => entry?.type === 'response').length;
    assert.equal(responseCountAfterRestart, 0, 'Worker restart must not manufacture a response transcript commit');

    const afterKill = await extensionStorage(cdp, extensionId, ['aiBridgeRuntimeDispatchLedger', 'bridgeState']);
    const recordsAfterKill = afterKill.aiBridgeRuntimeDispatchLedger?.records || [];
    assert.equal(recordsAfterKill.length, 1);
    assert.equal(recordsAfterKill[0].dispatchId, recordsBeforeKill[0].dispatchId);
    assert.equal(recordsAfterKill[0].status, 'DELIVERY_AMBIGUOUS');
    assert.equal(afterKill.bridgeState?.paused, true);

    const actionCountBeforeResume = await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount');
    const resume = await extensionMessage(cdp, dashboardAfter.sessionId, {
      type: 'AI_BRIDGE_RESUME',
      tabA: providerTabs.a,
      tabB: providerTabs.b,
      labelA: 'Fixture ChatGPT A',
      labelB: 'Fixture ChatGPT B'
    });
    assert.equal(resume.transportOk, true, 'Resume transport should succeed so the runtime can return its fail-closed application result');
    assert.equal(resume.value?.ok, false, 'Resume should fail closed while an ambiguous dispatch exists');
    assert.match(String(resume.value?.error || ''), /UNRESOLVED_DISPATCH_BLOCKS_REPLAY|unresolved|ambiguous/i);

    await sleep(500);
    const actionCountAfterResume = await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount');
    assert.equal(actionCountAfterResume, actionCountBeforeResume, 'Resume replayed an ambiguous provider action');

    const afterResume = await extensionStorage(cdp, extensionId, ['aiBridgeRuntimeDispatchLedger', 'bridgeState']);
    const recordsAfterResume = afterResume.aiBridgeRuntimeDispatchLedger?.records || [];
    assert.equal(recordsAfterResume.length, 1, 'Resume changed the number of durable dispatches');
    assert.equal(recordsAfterResume[0].dispatchId, recordsAfterKill[0].dispatchId, 'Resume replaced the ambiguous dispatch ID');
    assert.equal(recordsAfterResume[0].status, 'DELIVERY_AMBIGUOUS', 'Resume changed ambiguous delivery state');
    assert.equal(afterResume.bridgeState?.paused, true, 'Resume should leave the session paused after fail-closed refusal');
    assert.equal(afterResume.bridgeState?.running, false, 'Resume should not leave the session running after fail-closed refusal');
    const responseCountAfterResume = (afterResume.bridgeState?.transcript || []).filter(entry => entry?.type === 'response').length;
    assert.equal(responseCountAfterResume, 0, 'Resume refusal must not mutate the response transcript');

    const lostAckUi = await assertPausedDashboard(
      cdp,
      dashboardAfter,
      /ambiguous|interrupted|replay/i
    );
    assert.match(lostAckUi.pill, /^Paused$/i);

    const lostAckProviderUi = await poll(
      () => evaluate(
        cdp,
        dashboardAfter.sessionId,
        '({health:document.getElementById("healthA")?.textContent||"",newChatDisabled:Boolean(document.getElementById("newChatA")?.disabled),freshDisabled:Boolean(document.getElementById("freshOnStart")?.disabled)})'
      ),
      value =>
        /Connection:\s*Connected/i.test(String(value?.health || '')) &&
        /Authority:\s*Verified/i.test(String(value?.health || '')) &&
        /Relay:\s*READY/i.test(String(value?.health || '')) &&
        /Rollover:\s*LIMITED/i.test(String(value?.health || '')) &&
        /Artifacts:\s*LIMITED/i.test(String(value?.health || '')) &&
        value?.newChatDisabled === true &&
        value?.freshDisabled === true,
      10000
    );
    assert.match(lostAckProviderUi.health, /Connection:\s*Connected/i);
    assert.match(lostAckProviderUi.health, /Authority:\s*Verified/i);
    assert.match(lostAckProviderUi.health, /Relay:\s*READY/i);
    assert.match(lostAckProviderUi.health, /Rollover:\s*LIMITED/i);
    assert.match(lostAckProviderUi.health, /Artifacts:\s*LIMITED/i);
    assert.equal(lostAckProviderUi.newChatDisabled, true);
    assert.equal(lostAckProviderUi.freshDisabled, true);

    const workers = (await cdp.send('Target.getTargets')).targetInfos.filter(target =>
      target.type === 'service_worker' &&
      target.url === 'chrome-extension://' + extensionId + '/background.js'
    );
    assert.equal(workers.length, 1, 'MV3 worker did not restart cleanly');

    // Recovery-snapshot matrix: exercise durable states directly through the
    // DevTools Extensions storage API. These cases validate what a restarted
    // MV3 worker actually sees, without adding test-only hooks to production code.
    const baseActionCountA = await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount');
    const baseActionCountB = await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount');
    const baseState = {
      ...afterResume.bridgeState,
      stateVersion: 3,
      agentCount: 2,
      sessionActive: true,
      running: true,
      paused: false,
      pauseReason: '',
      runtimePhase: 'AWAITING_PROVIDER_RESPONSE',
      nextTurnPending: null,
      tabA: providerTabs.a,
      tabB: providerTabs.b,
      currentSide: 'B',
      startSide: 'A',
      mainSide: 'A',
      workMode: 'relay',
      workPhase: 'relay',
      turn: 1,
      maxTurns: 4,
      transcript: [{
        seq: 1,
        time: Date.now(),
        type: 'response',
        side: 'A',
        label: 'Fixture ChatGPT A',
        text: 'Seeded committed response for MV3 recovery matrix.'
      }],
      nextSeq: 2,
      log: []
    };
    const baseDispatchCreatedAt = Number(recordsAfterResume[0]?.createdAt) || Date.now();
    const baseDispatchAcceptedAt = Math.max(baseDispatchCreatedAt, Date.now());
    const baseDispatch = {
      ...recordsAfterResume[0],
      dispatchId: 'e2e-seeded-source-d1',
      side: 'A',
      tabId: providerTabs.a,
      purpose: 'RELAY',
      payloadHash: 'e2e-seeded-hash',
      createdAt: baseDispatchCreatedAt,
      acceptedAt: baseDispatchAcceptedAt,
      completedAt: null,
      failureReason: null
    };
    const committedBaseDispatch = {
      ...baseDispatch,
      status: 'RESPONSE_COMMITTED',
      completedAt: baseDispatchAcceptedAt + 1
    };

    // Case 1: a committed response with no continuation and no other live work
    // is impossible for a running session. Recovery must pause rather than guess.
    await cdp.send('Target.closeTarget', { targetId: dashboardAfter.targetId });
    const dashboardAfterIndex = pages.indexOf(dashboardAfter);
    if (dashboardAfterIndex >= 0) pages.splice(dashboardAfterIndex, 1);
    await cdp.send('ServiceWorker.stopAllWorkers');
    await poll(() => workerTarget(cdp, extensionId), value => value === null, 10000);
    await setExtensionStorage(cdp, extensionId, {
      bridgeState: { ...baseState },
      aiBridgeRuntimeDispatchLedger: { records: [committedBaseDispatch] },
      aiBridgeRuntimeParkedResponses: { records: [] }
    });

    const dashboardMissingContinuation = await createExtensionPage(cdp, extensionId, 'dashboard.html');
    pages.push(dashboardMissingContinuation);
    const missingContinuationState = await poll(async () => {
      const response = await extensionMessage(cdp, dashboardMissingContinuation.sessionId, { type: 'AI_BRIDGE_GET_STATE', omitTranscript: false });
      return response.transportOk ? response.value?.state : null;
    }, state => state?.paused === true && /RUNTIME_CONTINUATION_STATE_INCONSISTENT/.test(state?.pauseReason || ''), 15000);
    assert.equal(missingContinuationState.running, false);
    assert.equal(missingContinuationState.runtimePhase, 'PAUSED');
    assert.equal((missingContinuationState.transcript || []).filter(entry => entry?.type === 'response').length, 1);
    assert.equal(await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount'), baseActionCountA);
    assert.equal(await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount'), baseActionCountB);
    const missingContinuationUi = await assertPausedDashboard(
      cdp,
      dashboardMissingContinuation,
      /RUNTIME_CONTINUATION_STATE_INCONSISTENT|committed response is missing its durable next-turn record/i
    );

    const seededHealth = await poll(async () => {
      const health = await extensionMessage(cdp, dashboardMissingContinuation.sessionId, { type: 'AI_BRIDGE_PROVIDER_HEALTH', tabId: providerTabs.a });
      if (!health.transportOk || !health.value?.ok) return null;
      return health.value;
    }, value =>
      value?.connectionStatus === 'CONNECTED' &&
      value?.actionAuthorityStatus === 'DOCUMENT_AUTHORITY_VERIFIED' &&
      value?.capabilities?.relay === 'READY',
    15000);
    assert.equal(seededHealth.capabilities.rollover, 'LIMITED');
    assert.equal(seededHealth.capabilities.artifacts, 'LIMITED');
    const case1AfterHealth = await extensionMessage(cdp, dashboardMissingContinuation.sessionId, { type: 'AI_BRIDGE_GET_STATE', omitTranscript: true });
    assert.equal(case1AfterHealth.value?.state?.paused, true);
    assert.equal(case1AfterHealth.value?.state?.running, false);

    // Case 2: continuation marker durable but source not committed. This is the
    // "marker save succeeded / ledger commit failed" snapshot and must pause.
    await cdp.send('Target.closeTarget', { targetId: dashboardMissingContinuation.targetId });
    const missingIndex = pages.indexOf(dashboardMissingContinuation);
    if (missingIndex >= 0) pages.splice(missingIndex, 1);
    await cdp.send('ServiceWorker.stopAllWorkers');
    await poll(() => workerTarget(cdp, extensionId), value => value === null, 10000);

    const pendingMarker = {
      kind: 'SEQUENTIAL_SEND',
      sourceDispatchId: baseDispatch.dispatchId,
      sourceSide: 'A',
      targetSide: 'B',
      direct: false,
      outgoing: {
        text: 'Seeded next-turn payload that must not be sent until the source is committed.',
        deliveredSeq: 1,
        deliveredSources: false,
        artifactIds: [],
        mainInterjectionIds: []
      },
      createdAt: Date.now()
    };
    await setExtensionStorage(cdp, extensionId, {
      bridgeState: { ...baseState, nextTurnPending: pendingMarker, runtimePhase: 'NEXT_TURN_PENDING' },
      aiBridgeRuntimeDispatchLedger: { records: [{ ...baseDispatch, status: 'AWAITING_RESPONSE' }] },
      aiBridgeRuntimeParkedResponses: { records: [] }
    });

    const dashboardUncommittedSource = await createExtensionPage(cdp, extensionId, 'dashboard.html');
    pages.push(dashboardUncommittedSource);
    const uncommittedSourceState = await poll(async () => {
      const response = await extensionMessage(cdp, dashboardUncommittedSource.sessionId, { type: 'AI_BRIDGE_GET_STATE', omitTranscript: false });
      return response.transportOk ? response.value?.state : null;
    }, state => state?.paused === true && state?.running === false, 15000);
    assert.match(uncommittedSourceState.pauseReason || '', /next-turn|committed source|recovery|Automatic reconnect failed/i);
    assert.equal((uncommittedSourceState.transcript || []).filter(entry => entry?.type === 'response').length, 1);
    assert.equal(await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount'), baseActionCountA);
    assert.equal(await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount'), baseActionCountB);
    const uncommittedSourceUi = await assertPausedDashboard(
      cdp,
      dashboardUncommittedSource,
      /next-turn|committed source|recovery|Automatic reconnect failed/i
    );

    const matrixStorage = await extensionStorage(cdp, extensionId, ['aiBridgeRuntimeDispatchLedger', 'bridgeState']);
    assert.equal(matrixStorage.aiBridgeRuntimeDispatchLedger?.records?.[0]?.dispatchId, baseDispatch.dispatchId);
    assert.equal(matrixStorage.aiBridgeRuntimeDispatchLedger?.records?.[0]?.status, 'AWAITING_RESPONSE');
    assert.equal(matrixStorage.bridgeState?.paused, true);
    assert.equal(matrixStorage.bridgeState?.running, false);

    // Case 3: source committed + valid NEXT_TURN_PENDING is the safe positive
    // recovery path. Exactly one target dispatch must be created and sent.
    await cdp.send('Target.closeTarget', { targetId: dashboardUncommittedSource.targetId });
    const uncommittedIndex = pages.indexOf(dashboardUncommittedSource);
    if (uncommittedIndex >= 0) pages.splice(uncommittedIndex, 1);
    await cdp.send('ServiceWorker.stopAllWorkers');
    await poll(() => workerTarget(cdp, extensionId), value => value === null, 10000);

    await evaluate(cdp, providerB.sessionId, 'window.__autoConfirm=true;window.__emitResponse=false;true');
    const positiveActionCountABefore = await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount');
    const positiveActionCountBBefore = await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount');

    const positiveMarker = {
      ...pendingMarker,
      outgoing: {
        ...pendingMarker.outgoing,
        text: 'Seeded positive continuation: send exactly once to AI B.'
      },
      createdAt: Date.now()
    };
    await setExtensionStorage(cdp, extensionId, {
      bridgeState: { ...baseState, nextTurnPending: positiveMarker, runtimePhase: 'NEXT_TURN_PENDING' },
      aiBridgeRuntimeDispatchLedger: { records: [committedBaseDispatch] },
      aiBridgeRuntimeParkedResponses: { records: [] }
    });

    const dashboardPositive = await createExtensionPage(cdp, extensionId, 'dashboard.html');
    pages.push(dashboardPositive);

    await poll(
      () => evaluate(cdp, providerB.sessionId, 'window.__providerActionCount'),
      count => count === positiveActionCountBBefore + 1,
      15000
    );
    assert.equal(await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount'), positiveActionCountABefore);
    assert.equal(await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount'), positiveActionCountBBefore + 1);

    const positiveStorage = await poll(async () => {
      const stored = await extensionStorage(cdp, extensionId, ['aiBridgeRuntimeDispatchLedger', 'bridgeState']);
      const records = stored.aiBridgeRuntimeDispatchLedger?.records || [];
      const target = records.find(record => record.side === 'B' && record.dispatchId !== baseDispatch.dispatchId);
      if (!target || target.status !== 'AWAITING_RESPONSE' || stored.bridgeState?.nextTurnPending) return null;
      return { stored, target };
    }, Boolean, 15000);

    assert.equal(positiveStorage.stored.aiBridgeRuntimeDispatchLedger.records.filter(record => record.side === 'B').length, 1);
    assert.equal(positiveStorage.target.status, 'AWAITING_RESPONSE');
    assert.equal(positiveStorage.stored.bridgeState?.running, true);
    assert.equal(positiveStorage.stored.bridgeState?.paused, false);
    assert.equal(positiveStorage.stored.bridgeState?.runtimePhase, 'AWAITING_PROVIDER_RESPONSE');
    assert.equal((positiveStorage.stored.bridgeState?.transcript || []).filter(entry => entry?.type === 'response').length, 1);

    const positiveUi = await assertRunningAwaitingDashboard(cdp, dashboardPositive, { timeoutMs: 15000 });
    assert.match(positiveUi.status, /Awaiting provider response/i);

    // Case 4: CLAIMED parked response + source AWAITING_RESPONSE means response
    // mutation ownership was interrupted. Restart must pause, never replay it.
    await cdp.send('Target.closeTarget', { targetId: dashboardPositive.targetId });
    const positiveIndex = pages.indexOf(dashboardPositive);
    if (positiveIndex >= 0) pages.splice(positiveIndex, 1);
    await cdp.send('ServiceWorker.stopAllWorkers');
    await poll(() => workerTarget(cdp, extensionId), value => value === null, 10000);

    const claimedNow = Date.now();
    await setExtensionStorage(cdp, extensionId, {
      bridgeState: { ...baseState, runtimePhase: 'AWAITING_PROVIDER_RESPONSE' },
      aiBridgeRuntimeDispatchLedger: { records: [{ ...baseDispatch, status: 'AWAITING_RESPONSE' }] },
      aiBridgeRuntimeParkedResponses: {
        records: [{
          dispatchId: baseDispatch.dispatchId,
          state: 'CLAIMED',
          envelope: { dispatchId: baseDispatch.dispatchId, side: 'A', text: 'Seeded claimed response.' },
          parkedAt: claimedNow - 1000,
          expiresAt: claimedNow + 60000,
          claimedAt: claimedNow - 500
        }]
      }
    });

    const dashboardClaimed = await createExtensionPage(cdp, extensionId, 'dashboard.html');
    pages.push(dashboardClaimed);
    const claimedState = await poll(async () => {
      const response = await extensionMessage(cdp, dashboardClaimed.sessionId, { type: 'AI_BRIDGE_GET_STATE', omitTranscript: false });
      return response.transportOk ? response.value?.state : null;
    }, state => state?.paused === true && state?.running === false, 15000);
    assert.match(claimedState.pauseReason || '', /response was interrupted|ambiguous response|durable commit|replay/i);
    assert.equal((claimedState.transcript || []).filter(entry => entry?.type === 'response').length, 1);
    assert.equal(await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount'), positiveActionCountABefore);
    assert.equal(await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount'), positiveActionCountBBefore + 1);
    await assertPausedDashboard(cdp, dashboardClaimed, /response was interrupted|ambiguous response|durable commit|replay/i);

    // Case 5: source committed + valid continuation + exact target CREATED.
    // Recovery must reuse that exact target dispatch ID, not allocate a new one.
    await cdp.send('Target.closeTarget', { targetId: dashboardClaimed.targetId });
    const claimedIndex = pages.indexOf(dashboardClaimed);
    if (claimedIndex >= 0) pages.splice(claimedIndex, 1);
    await cdp.send('ServiceWorker.stopAllWorkers');
    await poll(() => workerTarget(cdp, extensionId), value => value === null, 10000);

    const createdTarget = {
      ...positiveStorage.target,
      dispatchId: 'e2e-created-never-delivered-d1',
      status: 'CREATED',
      acceptedAt: null,
      completedAt: null,
      failureReason: null
    };
    assert.notEqual(
      createdTarget.dispatchId,
      positiveStorage.target.dispatchId,
      'CREATED recovery must use a dispatch ID never delivered to the surviving provider content document'
    );
    const priorDispatchIds = new Set(
      positiveStorage.stored.aiBridgeRuntimeDispatchLedger.records.map(record => record.dispatchId)
    );
    priorDispatchIds.add(baseDispatch.dispatchId);
    assert.equal(
      priorDispatchIds.has(createdTarget.dispatchId),
      false,
      'CREATED recovery dispatch ID must not overlap any earlier scenario dispatch'
    );
    const createdActionCountBefore = await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount');
    await setExtensionStorage(cdp, extensionId, {
      bridgeState: { ...baseState, nextTurnPending: positiveMarker, runtimePhase: 'NEXT_TURN_PENDING' },
      aiBridgeRuntimeDispatchLedger: {
        records: [
          committedBaseDispatch,
          createdTarget
        ]
      },
      aiBridgeRuntimeParkedResponses: { records: [] }
    });

    const dashboardCreated = await createExtensionPage(cdp, extensionId, 'dashboard.html');
    pages.push(dashboardCreated);
    await poll(
      () => evaluate(cdp, providerB.sessionId, 'window.__providerActionCount'),
      count => count === createdActionCountBefore + 1,
      15000
    );
    const createdRecovered = await poll(async () => {
      const stored = await extensionStorage(cdp, extensionId, ['aiBridgeRuntimeDispatchLedger', 'bridgeState']);
      const target = (stored.aiBridgeRuntimeDispatchLedger?.records || []).find(record => record.dispatchId === createdTarget.dispatchId);
      if (!target || target.status !== 'AWAITING_RESPONSE') return null;
      return { stored, target };
    }, Boolean, 15000);
    const createdTargets = createdRecovered.stored.aiBridgeRuntimeDispatchLedger.records.filter(record => record.side === 'B');
    assert.equal(createdTargets.length, 1, 'CREATED recovery allocated a replacement target dispatch');
    assert.equal(createdTargets[0].dispatchId, createdTarget.dispatchId, 'CREATED recovery did not reuse the original dispatch ID');
    assert.equal(createdRecovered.stored.bridgeState?.nextTurnPending, null);
    assert.equal(createdRecovered.stored.bridgeState?.running, true);
    assert.equal(createdRecovered.stored.bridgeState?.paused, false);
    assert.equal(createdRecovered.stored.bridgeState?.runtimePhase, 'AWAITING_PROVIDER_RESPONSE');
    assert.equal((createdRecovered.stored.bridgeState?.transcript || []).filter(entry => entry?.type === 'response').length, 1);

    const createdUi = await assertRunningAwaitingDashboard(cdp, dashboardCreated);
    assert.match(createdUi.status, /Runtime:\s*Awaiting provider response/i);

    // Cases 6/7: target DISPATCHING or ACCEPTED has crossed the provider-action
    // ambiguity boundary. Restart must convert the same ID to DELIVERY_AMBIGUOUS.
    // currentDashboard always tracks the live Dashboard from the preceding case.
    let currentDashboard = dashboardCreated;
    for (const seededStatus of ['DISPATCHING', 'ACCEPTED']) {
      await cdp.send('Target.closeTarget', { targetId: currentDashboard.targetId });
      const currentIndex = pages.indexOf(currentDashboard);
      if (currentIndex >= 0) pages.splice(currentIndex, 1);
      await cdp.send('ServiceWorker.stopAllWorkers');
      await poll(() => workerTarget(cdp, extensionId), value => value === null, 10000);

      const seededTarget = {
        ...positiveStorage.target,
        status: seededStatus,
        failureReason: null,
        ...(seededStatus === 'ACCEPTED' ? { acceptedAt: Date.now() } : {})
      };
      const actionBeforeAmbiguousRecoveryA = await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount');
      const actionBeforeAmbiguousRecoveryB = await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount');
      await setExtensionStorage(cdp, extensionId, {
        bridgeState: { ...baseState, nextTurnPending: positiveMarker, runtimePhase: 'DISPATCHING' },
        aiBridgeRuntimeDispatchLedger: {
          records: [
            committedBaseDispatch,
            seededTarget
          ]
        },
        aiBridgeRuntimeParkedResponses: { records: [] }
      });

      const dashboardAmbiguous = await createExtensionPage(cdp, extensionId, 'dashboard.html');
      pages.push(dashboardAmbiguous);
      const ambiguousRecovered = await poll(async () => {
        const stored = await extensionStorage(cdp, extensionId, ['aiBridgeRuntimeDispatchLedger', 'bridgeState']);
        const target = (stored.aiBridgeRuntimeDispatchLedger?.records || []).find(record => record.dispatchId === seededTarget.dispatchId);
        if (!target || target.status !== 'DELIVERY_AMBIGUOUS' || stored.bridgeState?.paused !== true) return null;
        return { stored, target };
      }, Boolean, 15000);

      assert.equal(ambiguousRecovered.target.dispatchId, seededTarget.dispatchId);
      assert.equal(ambiguousRecovered.target.status, 'DELIVERY_AMBIGUOUS');
      assert.equal(ambiguousRecovered.stored.bridgeState?.running, false);
      assert.equal(ambiguousRecovered.stored.bridgeState?.runtimePhase, 'PAUSED');
      assert.equal((ambiguousRecovered.stored.bridgeState?.transcript || []).filter(entry => entry?.type === 'response').length, 1);
      assert.equal(await evaluate(cdp, providerA.sessionId, 'window.__providerActionCount'), actionBeforeAmbiguousRecoveryA);
      assert.equal(await evaluate(cdp, providerB.sessionId, 'window.__providerActionCount'), actionBeforeAmbiguousRecoveryB);
      await assertPausedDashboard(cdp, dashboardAmbiguous, /delivery was interrupted|may already have been sent|replay|ambiguous/i);

      currentDashboard = dashboardAmbiguous;
    }

    console.log('chrome-e2e-runtime: PASS');
    console.log(JSON.stringify({
      extensionId,
      providerActionCount: actionCountAfterResume,
      dispatchId: recordsAfterKill[0].dispatchId,
      dispatchStatus: recordsAfterKill[0].status,
      runtimePhase: recoveredState.runtimePhase,
      paused: recoveredState.paused,
      providerAuthority: healthAfterRestart.actionAuthorityStatus,
      relayCapability: healthAfterRestart.capabilities.relay,
      responseTranscriptCount: responseCountAfterResume,
      positiveRecoveryDispatchStatus: positiveStorage.target.status,
      positiveRecoveryProviderBActionDelta: 1
    }, null, 2));
  } finally {
    for (const page of pages) {
      try { page.dispose?.(); } catch {}
      try { await cdp.send('Target.closeTarget', { targetId: page.targetId }, undefined, 1000); } catch {}
    }
    try { await cdp.send('Browser.close', {}, undefined, 1000); } catch {}
    if (proc.exitCode === null && !proc.killed) {
      try { proc.kill('SIGTERM'); } catch {}
    }
    if (proc.exitCode === null) {
      await Promise.race([new Promise(resolve => proc.once('exit', resolve)), sleep(2500)]);
    }
    if (proc.exitCode === null) {
      try { proc.kill('SIGKILL'); } catch {}
      await Promise.race([new Promise(resolve => proc.once('exit', resolve)), sleep(1500)]);
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (cleanupError) {
      console.warn('chrome-e2e-runtime: cleanup warning:', cleanupError?.message || cleanupError);
    }
  }
}

module.exports = Object.freeze({ assertPausedDashboard, assertRunningAwaitingDashboard });

if (require.main === module) {
  main().catch(error => {
    console.error('chrome-e2e-runtime: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
