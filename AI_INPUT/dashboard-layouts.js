(()=>{
  const LAYOUT_KEY="aiBridgeLayout";
  const WIDTH_KEY="aiBridgeControlPaneWidth";
  const ALLOWED=new Set(["studio","classic","focus"]);
  const MIN=20, MAX=42, DEFAULT=26;
  const clamp=value=>Math.min(MAX,Math.max(MIN,Number.isFinite(Number(value))?Number(value):DEFAULT));
  const controlPanel=document.querySelector(".control-panel");
  const classicRightPanel=document.getElementById("classicRightPanel");
  const runtimePanel=controlPanel?.querySelector(".runtime-card")||null;
  const teamPanel=runtimePanel?.nextElementSibling||null;
  const classicMovables=[];
  if(controlPanel&&classicRightPanel&&runtimePanel&&teamPanel){
    for(const node of [...controlPanel.children]){
      if(node===controlPanel.querySelector(".brand-block")||node===runtimePanel||node===teamPanel) continue;
      const marker=document.createComment("classic-home");
      controlPanel.insertBefore(marker,node);
      classicMovables.push({node,marker});
    }
  }
  function syncClassicPanels(value){
    if(!classicRightPanel||!controlPanel) return;
    if(value==="classic"){
      classicRightPanel.hidden=false;
      const human=classicMovables.find(item=>item.node.classList?.contains("interject-panel"));
      if(human) classicRightPanel.appendChild(human.node);
      for(const item of classicMovables) if(item!==human) classicRightPanel.appendChild(item.node);
      return;
    }
    for(const item of classicMovables) item.marker.parentNode?.insertBefore(item.node,item.marker.nextSibling);
    classicRightPanel.hidden=true;
  }
  function applyLayout(raw){const value=ALLOWED.has(raw)?raw:"classic";document.documentElement.dataset.layout=value;syncClassicPanels(value);return value}
  function applyWidth(raw){
    const value=clamp(raw);
    document.documentElement.style.setProperty("--bridge-control-width",value+"vw");
    const splitter=document.getElementById("paneSplitter");
    if(splitter){
      splitter.setAttribute("aria-valuenow",String(Math.round(value)));
      splitter.setAttribute("aria-valuetext",Math.round(value)+" percent");
    }
    return value;
  }
  async function persistWidth(value){const width=applyWidth(value);await chrome.storage.local.set({[WIDTH_KEY]:width})}
  chrome.storage.local.get([LAYOUT_KEY,WIDTH_KEY]).then(v=>{applyLayout(v[LAYOUT_KEY]);applyWidth(v[WIDTH_KEY])}).catch(()=>{applyLayout("classic");applyWidth(DEFAULT)});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes[LAYOUT_KEY])applyLayout(changes[LAYOUT_KEY].newValue);
    if(changes[WIDTH_KEY])applyWidth(changes[WIDTH_KEY].newValue);
  });
  function navigateToExtensionPage(page) {
    const url = chrome.runtime.getURL(page);
    if (window.location.href !== url) window.location.assign(url);
  }
  document.getElementById("openSettings")?.addEventListener("click",()=>navigateToExtensionPage("settings.html"));

  const splitter=document.getElementById("paneSplitter");
  const shell=document.querySelector(".app-shell");
  if(!splitter||!shell)return;
  let dragging=false;
  const widthFromX=x=>clamp((x/window.innerWidth)*100);
  splitter.addEventListener("pointerdown",event=>{
    if(event.button!==0)return;
    dragging=true;
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
    applyWidth(widthFromX(event.clientX));
  });
  splitter.addEventListener("pointermove",event=>{if(dragging)applyWidth(widthFromX(event.clientX))});
  const end=async event=>{
    if(!dragging)return;
    dragging=false;
    document.body.classList.remove("is-resizing");
    try{splitter.releasePointerCapture(event.pointerId)}catch(_){}
    const raw=getComputedStyle(document.documentElement).getPropertyValue("--bridge-control-width");
    await persistWidth(Number.parseFloat(raw));
  };
  splitter.addEventListener("pointerup",end);
  splitter.addEventListener("pointercancel",end);
  splitter.addEventListener("dblclick",()=>persistWidth(DEFAULT));
  splitter.addEventListener("keydown",event=>{
    const current=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bridge-control-width"))||DEFAULT;
    let next=current;
    if(event.key==="ArrowLeft")next=current-1;
    else if(event.key==="ArrowRight")next=current+1;
    else if(event.key==="Home")next=MIN;
    else if(event.key==="End")next=MAX;
    else if(event.key==="Enter"||event.key===" ")next=DEFAULT;
    else return;
    event.preventDefault();
    persistWidth(next);
  });
})();
