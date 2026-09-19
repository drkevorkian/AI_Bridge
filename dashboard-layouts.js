(()=>{
  const KEY="aiBridgeLayout", ALLOWED=new Set(["studio","classic","focus"]);
  function apply(raw){const value=ALLOWED.has(raw)?raw:"studio";document.documentElement.dataset.layout=value;return value}
  chrome.storage.local.get(KEY).then(v=>apply(v[KEY])).catch(()=>apply("studio"));
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes[KEY])apply(changes[KEY].newValue)});
  document.getElementById("openSettings")?.addEventListener("click",()=>chrome.tabs.create({url:chrome.runtime.getURL("settings.html")}));
})();
