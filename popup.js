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
  const max = Number(s?.maxCycles ?? s?.maxTurns);
  return max === -1 ? "∞" : String(Number.isInteger(max) ? max : "?");
}

function formatDurationMs(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) < 0) return "";
  const value = Number(ms);
  if (value < 60000) return `${(value / 1000).toFixed(1)}s`;
  const total = Math.round(value / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes < 60 ? `${minutes}m ${seconds}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function liveRoundLine(s) {
  const started = s?.roundStartedAtBySide || {};
  const parts = [];
  const sides = Array.isArray(s?.activeSides) && s.activeSides.length
    ? s.activeSides.filter(side => /^[A-E]$/.test(String(side)))
    : ["A", "B", "C"];
  for (const side of sides) {
    const startedAt = Number(started[side]);
    if (Number.isFinite(startedAt) && startedAt > 0) {
      const round = Math.max(1, Number(s?.roundNumberBySide?.[side]) || 1);
      parts.push(`AI ${side} R${round} ${formatDurationMs(Date.now() - startedAt)}`);
    }
  }
  return parts.length ? `\nClock: ${parts.join(" · ")}` : "";
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
    const cycles = Number(s?.cycleCount) || 0;
    if (s.sessionActive && s.awaitingHuman) {
      $("status").textContent = `Human input needed\n${s.pendingHuman?.requestingLabel || `AI ${s.pendingHuman?.requestingSide || ""}`} is waiting.\nCycles: ${cycles}/${limit}`;
    } else if (s.sessionActive && s.running) {
      $("status").textContent = `Running · cycle ${cycles}/${limit}\nCurrent: AI ${s.currentSide || "?"}${liveRoundLine(s)}`;
    } else if (s.sessionActive) {
      $("status").textContent = `Paused · cycle ${cycles}/${limit}\n${s.pauseReason || "Session saved."}`;
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

$("openSettings").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_OPEN_DASHBOARD", hash: "settings" });
  if (!res?.ok) $("status").textContent = `Could not open settings: ${res?.error || "Unknown error"}`;
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
