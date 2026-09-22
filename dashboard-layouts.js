(()=>{
  const LAYOUT_KEY="aiBridgeLayout";
  const WIDTH_KEY="aiBridgeControlPaneWidth";
  const ALLOWED=new Set(["studio","classic","focus"]);
  const MIN=24, MAX=70, DEFAULT=30;
  const clamp=value=>Math.min(MAX,Math.max(MIN,Number.isFinite(Number(value))?Number(value):DEFAULT));
  const controlPanel=document.querySelector(".control-panel");
  const studioRightPanel=document.getElementById("studioRightPanel");
  const brand=controlPanel?.querySelector(".brand-block")||null;
  const runtimePanel=controlPanel?.querySelector(".runtime-card")||null;
  const teamPanel=runtimePanel?.nextElementSibling||null;
  const studioMovables=[];

  if(controlPanel&&studioRightPanel&&brand&&runtimePanel&&teamPanel){
    for(const node of [...controlPanel.children]){
      if(node===brand||node===runtimePanel||node===teamPanel) continue;
      const marker=document.createComment("studio-home");
      controlPanel.insertBefore(marker,node);
      studioMovables.push({node,marker});
    }
  }

  function restoreMovables(){
    for(const {node,marker} of studioMovables){
      if(marker.parentNode) marker.parentNode.insertBefore(node,marker.nextSibling);
    }
    if(studioRightPanel) studioRightPanel.hidden=true;
  }

  function moveToStudioRight(){
    if(!studioRightPanel) return;
    studioRightPanel.hidden=false;
    const human=studioMovables.find(item=>item.node.classList?.contains("interject-panel"));
    if(human) studioRightPanel.appendChild(human.node);
    for(const item of studioMovables){
      if(item!==human) studioRightPanel.appendChild(item.node);
    }
  }

  function applyLayout(raw){
    const value=ALLOWED.has(raw)?raw:"studio";
    restoreMovables();
    document.documentElement.dataset.layout=value;
    if(value==="studio") moveToStudioRight();
    return value;
  }

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

  async function persistWidth(value){
    const width=applyWidth(value);
    await chrome.storage.local.set({[WIDTH_KEY]:width});
  }

  chrome.storage.local.get([LAYOUT_KEY,WIDTH_KEY]).then(stored=>{
    applyLayout(stored[LAYOUT_KEY]);
    applyWidth(stored[WIDTH_KEY]);
  }).catch(()=>{
    applyLayout("studio");
    applyWidth(DEFAULT);
  });

  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local") return;
    if(changes[LAYOUT_KEY]) applyLayout(changes[LAYOUT_KEY].newValue);
    if(changes[WIDTH_KEY]) applyWidth(changes[WIDTH_KEY].newValue);
  });

  document.getElementById("openSettings")?.addEventListener("click",()=>{
    chrome.tabs.create({url:chrome.runtime.getURL("settings.html")});
  });

  const splitter=document.getElementById("paneSplitter");
  const shell=document.querySelector(".app-shell");
  if(!splitter||!shell) return;
  let dragging=false;
  const widthFromX=x=>clamp((x/window.innerWidth)*100);
  splitter.addEventListener("pointerdown",event=>{
    if(event.button!==0) return;
    dragging=true;
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
    applyWidth(widthFromX(event.clientX));
  });
  splitter.addEventListener("pointermove",event=>{if(dragging) applyWidth(widthFromX(event.clientX))});
  const end=async event=>{
    if(!dragging) return;
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
    if(event.key==="ArrowLeft") next=current-1;
    else if(event.key==="ArrowRight") next=current+1;
    else if(event.key==="Home") next=MIN;
    else if(event.key==="End") next=MAX;
    else if(event.key==="Enter"||event.key===" ") next=DEFAULT;
    else return;
    event.preventDefault();
    persistWidth(next);
  });
})();
