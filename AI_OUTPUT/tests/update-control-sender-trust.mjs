import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");
const start=bg.indexOf("function reviewTrustedExtensionPage");
const end=bg.indexOf("async function reviewCaptureUpdateBindings",start);
assert.ok(start>=0&&end>start,"trusted extension-page sender gate missing");

const fnSource=bg.slice(start,end);
const chrome={runtime:{id:"abc123"}};
const trust=(new Function("chrome",fnSource+"; return reviewTrustedExtensionPage;"))(chrome);
const origin="chrome-extension://abc123";

const settingsTab={
  id:"abc123",url:origin+"/settings.html",origin,frameId:0,documentLifecycle:"active",
  tab:{id:42,url:origin+"/settings.html"}
};
const dashboardTab={
  id:"abc123",url:origin+"/dashboard.html",origin,frameId:0,documentLifecycle:"active",
  tab:{id:43,url:origin+"/dashboard.html"}
};
const popup={
  id:"abc123",url:origin+"/popup.html",origin,frameId:0,documentLifecycle:"active"
};

assert.equal(trust(settingsTab),true,"Settings extension tab must be trusted");
assert.equal(trust(dashboardTab),true,"Dashboard extension tab must be trusted");
assert.equal(trust(popup),true,"Popup extension context must be trusted");

assert.equal(trust({
  id:"abc123",url:"https://chatgpt.com/c/x",origin:"https://chatgpt.com",frameId:0,
  documentLifecycle:"active",tab:{id:1,url:"https://chatgpt.com/c/x"}
}),false,"ChatGPT content script must be rejected");

assert.equal(trust({
  id:"abc123",url:"https://grok.com/c/x",origin:"https://grok.com",frameId:0,
  documentLifecycle:"active",tab:{id:2,url:"https://grok.com/c/x"}
}),false,"Grok content script must be rejected");

assert.equal(trust({
  id:"foreign",url:"chrome-extension://foreign/settings.html",
  origin:"chrome-extension://foreign",frameId:0,documentLifecycle:"active"
}),false,"foreign extension must be rejected");

assert.equal(trust({
  id:undefined,url:"https://example.com/",origin:"https://example.com",frameId:0,
  documentLifecycle:"active",tab:{id:3,url:"https://example.com/"}
}),false,"web page must be rejected");

assert.equal(trust({
  id:"abc123",url:origin+"/settings.html",origin,frameId:7,documentLifecycle:"active"
}),false,"extension iframe must be rejected");

assert.equal(trust({
  id:"abc123",url:origin+"/settings.html",origin:"https://evil.example",frameId:0,
  documentLifecycle:"active"
}),false,"origin mismatch must be rejected");

assert.equal(trust({
  id:"abc123",url:origin+"/settings.html",origin,frameId:0,documentLifecycle:"prerender"
}),false,"non-active extension document must be rejected");

console.log("update-control-sender-trust: PASS");
