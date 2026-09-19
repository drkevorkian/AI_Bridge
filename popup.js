const $ = id => document.getElementById(id);
const THEME_KEY = "aiBridgeTheme";
const THEMES = new Set(["blizzard", "ghostwhite", "midnight", "slate", "light", "solarized", "ocean", "terminal"]);

function applyTheme(theme) {
  const chosen = THEMES.has(theme) ? theme : "blizzard";
  document.documentElement.dataset.theme = chosen;
  $("themeSelect").value = chosen;
}

async function loadTheme() {
  const stored = await chrome.storage.local.get(THEME_KEY);
  applyTheme(stored?.[THEME_KEY]);
}

function limitLabel(s) {
  return Number(s?.maxTurns) === -1 ? "∞" : String(s?.maxTurns ?? "?");
}

function updatePill(s) {
  const pill = $("pill");
  pill.className = "pill";
  if (s?.sessionActive && s.awaitingHuman) {
    pill.classList.add("paused");
    pill.textContent = "Needs human";
  } else if (s?.sessionActive && s.running) {
    pill.classList.add("running");
    pill.textContent = "Running";
  } else if (s?.sessionActive) {
    pill.classList.add("paused");
    pill.textContent = "Paused";
  } else {
    pill.classList.add("idle");
    pill.textContent = "Idle";
  }
}

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_GET_STATE", omitTranscript: true });
    const s = res?.state;
    if (!s) return;
    updatePill(s);
    const limit = limitLabel(s);
    if (s.sessionActive && s.awaitingHuman) {
      $("status").textContent = `Human input needed\n${s.pendingHuman?.requestingLabel || `AI ${s.pendingHuman?.requestingSide || ""}`} is waiting.\nTurns: ${s.turn}/${limit}`;
    } else if (s.sessionActive && s.running) {
      $("status").textContent = `Running · turns ${s.turn}/${limit}\nCurrent: AI ${s.currentSide || "?"}`;
    } else if (s.sessionActive) {
      $("status").textContent = `Paused · turns ${s.turn}/${limit}\n${s.pauseReason || "Session saved."}`;
    } else {
      $("status").textContent = "Idle — open the dashboard to configure or start a session.";
    }
    $("pause").disabled = !s.sessionActive || !s.running || s.awaitingHuman;
    $("stop").disabled = !s.sessionActive;
  } catch (err) {
    $("status").textContent = `State error: ${err.message}`;
  }
}

$("themeSelect").addEventListener("change", async event => {
  const theme = THEMES.has(event.target.value) ? event.target.value : "blizzard";
  applyTheme(theme);
  await chrome.storage.local.set({ [THEME_KEY]: theme });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue);
});

$("openDashboard").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_OPEN_DASHBOARD" });
  if (!res?.ok) $("status").textContent = `Could not open dashboard: ${res?.error || "Unknown error"}`;
});

$("pause").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_PAUSE" });
  if (!res?.ok) $("status").textContent = `Pause failed: ${res?.error || "Unknown error"}`;
  await refresh();
});

$("stop").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_STOP" });
  if (!res?.ok) $("status").textContent = `Stop failed: ${res?.error || "Unknown error"}`;
  await refresh();
});

loadTheme().then(refresh);
setInterval(refresh, 900);
