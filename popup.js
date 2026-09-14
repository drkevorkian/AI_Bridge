const SIDES = ["A", "B", "C"];
const supported = [
  { re: /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//, name: "ChatGPT" },
  { re: /^https:\/\/grok\.com\//, name: "Grok" },
  { re: /^https:\/\/claude\.ai\//, name: "Claude" },
  { re: /^https:\/\/gemini\.google\.com\//, name: "Gemini" },
  { re: /^https:\/\/copilot\.microsoft\.com\//, name: "Copilot" }
];

const $ = id => document.getElementById(id);
let tabsById = new Map();
let latestState = null;
let hydrated = false;

function aiName(url) {
  return supported.find(x => x.re.test(url || ""))?.name || "AI";
}

function selectedTab(side) {
  return Number($(`tab${side}`).value);
}

function setSelectToTab(side, tabId) {
  if (!tabId || !tabsById.has(Number(tabId))) return false;
  $(`tab${side}`).value = String(tabId);
  return true;
}

function refreshStartLabels() {
  for (const side of SIDES) {
    const tab = tabsById.get(selectedTab(side));
    const option = [...$('startSide').options].find(o => o.value === side);
    if (option) option.textContent = `${aiName(tab?.url)} (AI ${side}) starts`;
  }
}

async function loadTabs() {
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter(t => supported.some(x => x.re.test(t.url || "")));
  tabsById = new Map(candidates.map(t => [t.id, t]));

  for (const side of SIDES) {
    const select = $(`tab${side}`);
    select.textContent = "";
    for (const tab of candidates) {
      const opt = document.createElement("option");
      opt.value = String(tab.id);
      opt.textContent = `${aiName(tab.url)} — ${tab.title || tab.url}`;
      select.appendChild(opt);
    }
  }

  if (candidates[0]) $('tabA').value = String(candidates[0].id);
  if (candidates[1]) $('tabB').value = String(candidates[1].id);
  if (candidates[2]) $('tabC').value = String(candidates[2].id);
  refreshStartLabels();

  if (candidates.length < 3) {
    $('status').textContent = "Open at least three supported AI chat tabs, then reopen this popup.";
  }
}

function hydrateFromState(s) {
  if (hydrated || !s) return;
  hydrated = true;

  for (const side of SIDES) {
    setSelectToTab(side, s[`tab${side}`]);
    if (s[`job${side}`]) $(`job${side}`).value = s[`job${side}`];
  }
  if (s.initialPrompt) $('prompt').value = s.initialPrompt;
  if (s.startSide && SIDES.includes(s.startSide)) $('startSide').value = s.startSide;
  if (s.maxTurns) $('maxTurns').value = s.maxTurns;
  if (Number.isFinite(Number(s.delayMs))) $('delayMs').value = s.delayMs;
  refreshStartLabels();
}

function setHumanPanel(s) {
  const panel = $('humanPanel');
  if (s?.sessionActive && s.awaitingHuman && s.pendingHuman) {
    panel.classList.remove('hidden');
    $('humanWho').textContent = `${s.pendingHuman.requestingLabel || `AI ${s.pendingHuman.requestingSide || ''}`} is waiting for you:`;
    $('humanQuestion').textContent = s.pendingHuman.prompt || 'Human input requested.';
    $('sendHuman').disabled = false;
  } else {
    panel.classList.add('hidden');
    $('humanQuestion').textContent = "";
    $('humanWho').textContent = "";
  }
}

function labelForCurrent(s) {
  const side = s.currentSide;
  if (!side) return "none";
  return `${s[`label${side}`] || 'AI'} (AI ${side})`;
}

async function refreshState() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_GET_STATE" });
    const s = res?.state;
    if (!s) return;
    latestState = s;
    hydrateFromState(s);

    if (s.sessionActive && s.awaitingHuman && s.pendingHuman) {
      $('status').textContent = `PAUSED — HUMAN INPUT NEEDED\n${s.pendingHuman.requestingLabel || `AI ${s.pendingHuman.requestingSide}`} is waiting.\nAI turn ${s.turn}/${s.maxTurns}`;
    } else if (s.sessionActive && s.running) {
      $('status').textContent = `Running — AI turn ${s.turn}/${s.maxTurns}\nWaiting on: ${labelForCurrent(s)}\nTranscript events: ${s.transcript?.length || 0}`;
    } else if (s.sessionActive && s.paused) {
      $('status').textContent = `PAUSED — ${s.pauseReason || 'Session saved.'}\nNext/current: ${labelForCurrent(s)}\nAI turn ${s.turn}/${s.maxTurns}`;
    } else {
      $('status').textContent = `Idle${s.log?.length ? ` — ${s.log[s.log.length - 1].text || "stopped"}` : ""}`;
    }

    $('start').disabled = Boolean(s.sessionActive);
    $('pause').disabled = !s.sessionActive || !s.running || s.awaitingHuman;
    $('resume').disabled = !s.sessionActive || s.running || s.awaitingHuman;
    $('stop').disabled = !s.sessionActive;

    for (const side of SIDES) {
      $(`resend${side}`).disabled = !s.sessionActive || !s.running || s.awaitingHuman || !s.lastSentBySide?.[side];
    }

    setHumanPanel(s);
  } catch (err) {
    $('status').textContent = `Bridge state error: ${err.message}`;
  }
}

for (const side of SIDES) $(`tab${side}`).addEventListener('change', refreshStartLabels);

function selectedBindings() {
  const data = {};
  for (const side of SIDES) {
    const tabId = selectedTab(side);
    const tab = tabsById.get(tabId);
    data[`tab${side}`] = tabId;
    data[`label${side}`] = aiName(tab?.url);
  }
  return data;
}

function validateThreeTabs() {
  const ids = SIDES.map(selectedTab);
  if (ids.some(id => !id)) return "Choose three supported tabs.";
  if (new Set(ids).size !== 3) return "AI A, AI B, and AI C must be three different tabs.";
  return null;
}

$('start').addEventListener('click', async () => {
  const tabError = validateThreeTabs();
  if (tabError) return $('status').textContent = tabError;

  const initialPrompt = $('prompt').value.trim();
  if (!initialPrompt) return $('status').textContent = "Enter a primary objective or initial prompt.";

  $('status').textContent = "Starting three-AI session…";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_START",
      ...selectedBindings(),
      startSide: $('startSide').value,
      jobA: $('jobA').value.trim(),
      jobB: $('jobB').value.trim(),
      jobC: $('jobC').value.trim(),
      initialPrompt,
      maxTurns: Number($('maxTurns').value),
      delayMs: Number($('delayMs').value)
    });
    if (!res?.ok) throw new Error(res?.error || "Could not start");
    await refreshState();
  } catch (err) {
    $('status').textContent = `Start failed: ${err.message}`;
  }
});

$('pause').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_PAUSE" });
  if (!res?.ok) $('status').textContent = `Pause failed: ${res?.error || 'Unknown error'}`;
  await refreshState();
});

$('resume').addEventListener('click', async () => {
  const tabError = validateThreeTabs();
  if (tabError) return $('status').textContent = `${tabError}\nTo resume, bind all three roles to open AI tabs.`;

  $('status').textContent = "Restoring saved session…";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_RESUME",
      ...selectedBindings()
    });
    if (!res?.ok) throw new Error(res?.error || "Could not resume");
    await refreshState();
  } catch (err) {
    $('status').textContent = `Resume failed: ${err.message}`;
  }
});

$('stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: "AI_BRIDGE_STOP" });
  await refreshState();
});

async function resend(side) {
  if (!latestState?.sessionActive || !latestState?.running) return;
  const button = $(`resend${side}`);
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'Resending…';
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_RESEND", side });
    if (!res?.ok) throw new Error(res?.error || 'Resend failed');
  } catch (err) {
    $('status').textContent = `Resend failed: ${err.message}`;
  } finally {
    button.textContent = old;
    await refreshState();
  }
}

for (const side of SIDES) $(`resend${side}`).addEventListener('click', () => resend(side));

$('sendHuman').addEventListener('click', async () => {
  const text = $('humanResponse').value.trim();
  if (!text) return $('status').textContent = "Type your response to the AI first.";

  $('sendHuman').disabled = true;
  $('sendHuman').textContent = 'Sending…';
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_HUMAN_REPLY", text });
    if (!res?.ok) throw new Error(res?.error || 'Could not send human response');
    $('humanResponse').value = '';
  } catch (err) {
    $('status').textContent = `Human response failed: ${err.message}`;
  } finally {
    $('sendHuman').textContent = 'Send response & continue';
    await refreshState();
  }
});

loadTabs().then(refreshState);
setInterval(refreshState, 750);
