import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const base of ["AI_OUTPUT/runtime_review", "AI_INPUT"]) {
  const dashboardHtml = read(`${base}/dashboard.html`);
  const popupHtml = read(`${base}/popup.html`);
  const layoutJs = read(`${base}/dashboard-layouts.js`);
  const settingsJs = read(`${base}/settings.js`);
  const manifest = JSON.parse(read(`${base}/manifest.json`));

  assert(!dashboardHtml.includes("\\n"), `${base}/dashboard.html contains literal \\n text`);
  assert(!popupHtml.includes("\\n"), `${base}/popup.html contains literal \\n text`);

  assert(!layoutJs.includes('chrome.tabs.create({url:chrome.runtime.getURL("settings.html")}'),
    `${base}/dashboard-layouts.js still opens Settings in a new tab`);
  assert(layoutJs.includes('window.location.assign(url)'),
    `${base}/dashboard-layouts.js missing same-tab navigation`);

  assert(!settingsJs.includes('chrome.tabs.create({url:chrome.runtime.getURL("dashboard.html")}'),
    `${base}/settings.js still opens Dashboard in a new tab`);
  assert(settingsJs.includes('window.location.assign(url)'),
    `${base}/settings.js missing same-tab navigation`);

  assert(settingsJs.includes('LAYOUTS.has(layout)?layout:"classic"'),
    `${base}/settings.js layout fallback is not Classic`);
  assert(settingsJs.includes('[LAYOUT_KEY]:chosen'),
    `${base}/settings.js does not persist layout selection`);

  assert(/^1\.18\.1$/.test(manifest.version),
    `${base}/manifest.json expected version 1.18.1, got ${manifest.version}`);
}

console.log("UI navigation/layout regression checks passed.");
