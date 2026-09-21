const $ = id => document.getElementById(id);
const THEME_KEY = "aiBridgeTheme";
const LAYOUT_KEY = "aiBridgeLayout";
const AGENT_COUNT_KEY = "aiBridgeAgentCount";
const PANE_WIDTH_KEY = "aiBridgeControlPaneWidth";
const AUTO_UPDATE_KEY = "aiBridgeAutoCheckUpdates";
const KEEP_AWAKE_KEY = "aiBridgeKeepAwake";
const GOOGLE_CLIENT_KEY = "aiBridgeGoogleClientId";
const GOOGLE_TOKEN_KEY = "aiBridgeGoogleAccess";
const SYNC_KEY = "aiBridgePortableSettings";
const DRIVE_NAME = "AI Bridge Settings.json";
const THEMES = new Set(["blizzard","ghostwhite","midnight","slate","light","solarized","ocean","terminal"]);
const LAYOUTS = new Set(["classic"]);
const PROVIDERS = [
  { name:"ChatGPT", re:/^https:\/\/(chatgpt\.com|chat\.openai\.com)\// },
  { name:"Grok", re:/^https:\/\/grok\.com\// },
  { name:"Claude", re:/^https:\/\/claude\.ai\// },
  { name:"Gemini", re:/^https:\/\/gemini\.google\.com\// },
  { name:"Copilot", re:/^https:\/\/copilot\.microsoft\.com\// }
];
let latestZipUrl = "";
const UPDATE_TERMINAL_PHASES=new Set(["COMPLETE","FAILED","CANCELLED"]);
const UPDATE_CANCELLABLE_PHASES=new Set(["DRAINING","CHECKPOINTED"]);
const UPDATE_PHASE_TEXT=Object.freeze({
  DRAINING:"Waiting for the current AI action to finish safely…",
  CHECKPOINTED:"Safe update point reached.",
  APPLIED_NOT_RELOADED:"Update applied. Restarting AI Bridge…",
  RELOADED_NOT_REBOUND:"AI Bridge restarted. Reconnecting AI tabs…",
  READY_TO_RESUME:"Update verified. Restoring the session…",
  COMPLETE:"Update complete.",
  FAILED:"Update failed safely. Existing session was not resumed automatically.",
  CANCELLED:"Update cancelled."
});
const secureUpdater={
  busy:false,pinged:false,hostConnected:false,hostName:"",schema:null,
  releaseConfigured:null,releaseReady:false,algorithm:"",keyBits:0,
  checkedTarget:null,checkpoint:null,boundary:null
};

function show(id,text,error=false){const el=$(id);el.textContent=text;el.classList.remove("hidden");el.classList.toggle("error",error)}
function versionParts(v){return String(v||"0").split(".").map(x=>Number(x)||0)}
function newer(a,b){const A=versionParts(a),B=versionParts(b);for(let i=0;i<Math.max(A.length,B.length);i++){if((A[i]||0)!==(B[i]||0))return (A[i]||0)>(B[i]||0)}return false}
function timeout(promise,ms=2500){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Timed out")),ms))])}
function applyTheme(theme){const chosen=THEMES.has(theme)?theme:"blizzard";document.documentElement.dataset.theme=chosen;$("settingsTheme").value=chosen;return chosen}
async function setTheme(theme){const chosen=applyTheme(theme);await chrome.storage.local.set({[THEME_KEY]:chosen})}
async function setLayout(){await chrome.storage.local.set({[LAYOUT_KEY]:"classic"})}

async function portableSettings(){
  const local=await chrome.storage.local.get([THEME_KEY,LAYOUT_KEY,AGENT_COUNT_KEY,PANE_WIDTH_KEY,"bridgeState"]);
  const s=local.bridgeState||{};
  const jobs={}; for(const side of ["A","B","C","D","E"]) jobs["job"+side]=String(s["job"+side]||"");
  return {
    schema:1, savedAt:Date.now(),
    theme:THEMES.has(local[THEME_KEY])?local[THEME_KEY]:"blizzard",
    layout:"classic",
    paneWidth:Math.min(70,Math.max(24,Number(local[PANE_WIDTH_KEY])||36)),
    agentCount:Number(local[AGENT_COUNT_KEY]||s.agentCount||3),
    teamRules:String(s.teamRules||"").slice(0,12000),
    workMode:String(s.workMode||"relay"), startSide:String(s.startSide||"A"),
    maxTurns:Number.isInteger(Number(s.maxTurns))?Number(s.maxTurns):-1,
    delayMs:Number.isFinite(Number(s.delayMs))?Number(s.delayMs):1500,
    ...jobs
  };
}
async function applyPortableSettings(p){
  if(!p||p.schema!==1) throw new Error("Unsupported settings payload.");
  const writes={};
  if(THEMES.has(p.theme)) writes[THEME_KEY]=p.theme;
  writes[LAYOUT_KEY]="classic";
  if(Number.isFinite(Number(p.paneWidth))) writes[PANE_WIDTH_KEY]=Math.min(70,Math.max(24,Number(p.paneWidth)));
  if(Number.isInteger(Number(p.agentCount))&&Number(p.agentCount)>=1&&Number(p.agentCount)<=5) writes[AGENT_COUNT_KEY]=Number(p.agentCount);
  await chrome.storage.local.set(writes);
  const {bridgeState}=await chrome.storage.local.get("bridgeState");
  if(bridgeState&&!bridgeState.sessionActive){
    const next={...bridgeState};
    if(["relay","collaborate","compete","parallel","review","mesh"].includes(p.workMode)) next.workMode=p.workMode;
    if(["A","B","C","D","E"].includes(p.startSide)) next.startSide=p.startSide;
    if(Number.isInteger(Number(p.maxTurns))&&Number(p.maxTurns)>=-1&&Number(p.maxTurns)<=10000) next.maxTurns=Number(p.maxTurns);
    if(Number.isFinite(Number(p.delayMs))&&Number(p.delayMs)>=0&&Number(p.delayMs)<=30000) next.delayMs=Number(p.delayMs);
    if(typeof p.teamRules==="string") next.teamRules=p.teamRules.slice(0,12000);
    for(const side of ["A","B","C","D","E"]) if(typeof p["job"+side]==="string") next["job"+side]=p["job"+side].slice(0,12000);
    await chrome.storage.local.set({bridgeState:next});
  }
  applyTheme(p.theme);
  await setLayout();
  if(Number.isFinite(Number(p.paneWidth))){
    const width=Math.min(70,Math.max(24,Number(p.paneWidth)));
    $("paneWidth").value=String(width); $("paneWidthValue").textContent=Math.round(width)+"%";
  }
}
async function syncPush(){const payload=await portableSettings();await chrome.storage.sync.set({[SYNC_KEY]:payload});$("syncStatus").textContent="Synced";show("syncNotice","Settings pushed to Chrome Sync.")}
async function syncPull(){const obj=await chrome.storage.sync.get(SYNC_KEY);if(!obj[SYNC_KEY])throw new Error("No Chrome Sync settings were found.");await applyPortableSettings(obj[SYNC_KEY]);$("syncStatus").textContent="Synced";show("syncNotice","Newest Chrome Sync settings applied.")}

function b64url(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
async function sha256(text){return crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))}
function randomVerifier(){const b=new Uint8Array(48);crypto.getRandomValues(b);return b64url(b)}
async function googleToken(){
  const s=await chrome.storage.session.get(GOOGLE_TOKEN_KEY), t=s[GOOGLE_TOKEN_KEY];
  if(t?.accessToken&&Number(t.expiresAt)>Date.now()+30000)return t.accessToken;
  throw new Error("Google is not linked or the session token expired. Link Google again.");
}
async function linkGoogle(){
  const { [GOOGLE_CLIENT_KEY]:clientId }=await chrome.storage.local.get(GOOGLE_CLIENT_KEY);
  if(!clientId)throw new Error("Save a Google OAuth client ID first.");
  const verifier=randomVerifier(), challenge=b64url(await sha256(verifier)), redirect=chrome.identity.getRedirectURL("google");
  const state=randomVerifier();
  const q=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:"code",scope:"https://www.googleapis.com/auth/drive.appdata",code_challenge:challenge,code_challenge_method:"S256",state,access_type:"online",prompt:"consent"});
  const responseUrl=await chrome.identity.launchWebAuthFlow({url:"https://accounts.google.com/o/oauth2/v2/auth?"+q.toString(),interactive:true});
  const returned=new URL(responseUrl), code=returned.searchParams.get("code"), error=returned.searchParams.get("error"), returnedState=returned.searchParams.get("state");
  if(returnedState!==state)throw new Error("Google authorization state validation failed.");
  if(error)throw new Error("Google authorization failed: "+error); if(!code)throw new Error("Google did not return an authorization code.");
  const body=new URLSearchParams({client_id:clientId,code,code_verifier:verifier,grant_type:"authorization_code",redirect_uri:redirect});
  const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  const json=await res.json(); if(!res.ok||!json.access_token)throw new Error(json.error_description||json.error||"Token exchange failed.");
  await chrome.storage.session.set({[GOOGLE_TOKEN_KEY]:{accessToken:json.access_token,expiresAt:Date.now()+(Number(json.expires_in)||3600)*1000}});
  $("googleStatus").textContent="Linked for this Chrome session";
}
async function unlinkGoogle(){await chrome.storage.session.remove(GOOGLE_TOKEN_KEY);$("googleStatus").textContent="Not linked";show("googleNotice","Google session token cleared.")}
async function driveFind(token){
  const q=new URLSearchParams({spaces:"appDataFolder",q:"name='"+DRIVE_NAME.replace(/'/g,"\\'")+"' and trashed=false",fields:"files(id,name,modifiedTime)",orderBy:"modifiedTime desc",pageSize:"10"});
  const res=await fetch("https://www.googleapis.com/drive/v3/files?"+q,{headers:{Authorization:"Bearer "+token}});
  const j=await res.json(); if(!res.ok)throw new Error(j.error?.message||"Drive lookup failed."); return j.files?.[0]||null;
}
async function drivePush(){
  const token=await googleToken(), payload=JSON.stringify(await portableSettings(),null,2), found=await driveFind(token);
  let res;
  if(found){
    res=await fetch("https://www.googleapis.com/upload/drive/v3/files/"+encodeURIComponent(found.id)+"?uploadType=media",{method:"PATCH",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:payload});
  }else{
    const boundary="aibridge_"+crypto.randomUUID().replaceAll("-","");
    const body="--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+JSON.stringify({name:DRIVE_NAME,parents:["appDataFolder"]})+"\r\n--"+boundary+"\r\nContent-Type: application/json\r\n\r\n"+payload+"\r\n--"+boundary+"--";
    res=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"multipart/related; boundary="+boundary},body});
  }
  const j=await res.json();if(!res.ok)throw new Error(j.error?.message||"Drive push failed.");show("googleNotice","Settings pushed to Google Drive appDataFolder.");
}
async function drivePull(){
  const token=await googleToken(), found=await driveFind(token);if(!found)throw new Error("No AI Bridge settings file exists in Drive appDataFolder.");
  const res=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(found.id)+"?alt=media",{headers:{Authorization:"Bearer "+token}});
  if(!res.ok)throw new Error("Drive pull failed.");await applyPortableSettings(await res.json());show("googleNotice","Google Drive settings applied.");
}

async function health(){
  const tabs=await chrome.tabs.query({});
  const supported=tabs.filter(t=>PROVIDERS.some(p=>p.re.test(t.url||"")));
  $("healthList").textContent="";
  let verified=0;
  for(const tab of supported){
    const provider=PROVIDERS.find(p=>p.re.test(tab.url||""))?.name||"AI";
    const row=document.createElement("div");row.className="health-row";
    const p=document.createElement("strong");p.textContent=provider;
    const title=document.createElement("span");title.textContent=tab.title||tab.url||("Tab "+tab.id);
    const state=document.createElement("span");state.className="health-state";
    try{
      const res=await timeout(chrome.runtime.sendMessage({type:"AI_BRIDGE_PROVIDER_HEALTH",tabId:tab.id}),1800);
      if(!res?.ok) throw new Error(res?.error||"Health check failed");
      const connected=res.connectionStatus==="CONNECTED";
      const authority=res.actionAuthorityStatus==="DOCUMENT_AUTHORITY_VERIFIED";
      state.textContent=connected ? ("Connected · "+(authority?"Verified":"Not verified")) : "Disconnected";
      state.classList.add(authority?"ok":"bad");
      if(authority) verified++;
    }catch(_){state.textContent="Disconnected";state.classList.add("bad");}
    row.append(p,title,state);$("healthList").append(row);
  }
  $("healthSummary").textContent=supported.length?verified+"/"+supported.length+" verified":"No supported AI tabs open";
}

function secureUpdateError(response,fallback){
  return String(response?.error||response?.reason||fallback||"Updater operation failed.");
}
function setSecureUpdateNotice(text,error=false){
  const el=$("secureUpdateNotice");
  el.textContent=String(text||"");
  el.classList.toggle("error",Boolean(error));
}
function installedTarget(){
  const m=chrome.runtime.getManifest();
  return {version:String(m.version||""),build:String(m.version_name||m.version||"")};
}
function checkpointIsActive(checkpoint){
  return Boolean(checkpoint?.phase&&!UPDATE_TERMINAL_PHASES.has(String(checkpoint.phase)));
}
function targetMatchesInstalled(target){
  if(!target)return false;
  const current=installedTarget();
  return String(target.version)===current.version&&String(target.build)===current.build;
}
function renderSecureUpdater(){
  const cp=secureUpdater.checkpoint;
  $("nativeHostStatus").textContent=secureUpdater.hostConnected
    ? "Connected"+(secureUpdater.schema!=null?" · schema "+secureUpdater.schema:"")
    : (secureUpdater.pinged?"Not installed / unavailable":"Not tested");

  if(!secureUpdater.hostConnected){
    $("releaseTrustStatus").textContent="Unknown";
    $("verificationStatus").textContent="Unknown";
  }else if(secureUpdater.releaseConfigured===false){
    $("releaseTrustStatus").textContent="Not configured";
    $("verificationStatus").textContent="Not configured";
  }else if(!secureUpdater.releaseReady){
    $("releaseTrustStatus").textContent="Invalid configuration";
    $("verificationStatus").textContent=secureUpdater.algorithm||"Invalid configuration";
  }else{
    $("releaseTrustStatus").textContent="Ready";
    $("verificationStatus").textContent=secureUpdater.algorithm+
      (secureUpdater.keyBits>0?" · "+secureUpdater.keyBits+"-bit":"");
  }

  if(!secureUpdater.hostConnected||!secureUpdater.releaseReady){
    $("automaticApplyStatus").textContent="Disabled";
  }else if(checkpointIsActive(cp)){
    $("automaticApplyStatus").textContent=cp.phase==="CHECKPOINTED"?"Ready to apply":"In progress";
  }else{
    $("automaticApplyStatus").textContent="Ready";
  }

  if(cp?.phase){
    const detail=UPDATE_PHASE_TEXT[cp.phase]||String(cp.phase);
    $("checkpointStatus").textContent=String(cp.phase)+" · "+detail;
  }else{
    $("checkpointStatus").textContent="None";
  }

  const target=secureUpdater.checkedTarget;
  $("availableSignedUpdate").textContent=target
    ? "v"+target.version+" · "+target.build+" · "+target.files+" file"+(target.files===1?"":"s")+
      (targetMatchesInstalled(target)?" · already installed":"")
    : "Not checked";

  const active=checkpointIsActive(cp);
  $("testNativeUpdater").disabled=secureUpdater.busy;
  $("checkSignedUpdate").disabled=secureUpdater.busy||!secureUpdater.hostConnected||!secureUpdater.releaseReady||active;
  $("prepareNativeUpdate").disabled=secureUpdater.busy||!secureUpdater.hostConnected||!secureUpdater.releaseReady||
    !target||targetMatchesInstalled(target)||active;
  $("applyNativeUpdate").disabled=secureUpdater.busy||!secureUpdater.hostConnected||!secureUpdater.releaseReady||
    cp?.phase!=="CHECKPOINTED";
  $("cancelNativeUpdate").disabled=secureUpdater.busy||!UPDATE_CANCELLABLE_PHASES.has(String(cp?.phase||""));
}
async function refreshNativeUpdateStatus({quiet=false}={}){
  const response=await chrome.runtime.sendMessage({type:"AI_BRIDGE_UPDATE_STATUS"});
  if(!response?.ok)throw new Error(secureUpdateError(response,"Could not read update checkpoint status."));
  secureUpdater.checkpoint=response.checkpoint||null;
  secureUpdater.boundary=response.boundary||null;
  renderSecureUpdater();
  if(!quiet&&secureUpdater.checkpoint?.phase){
    const cp=secureUpdater.checkpoint;
    const detail=UPDATE_PHASE_TEXT[cp.phase]||String(cp.phase);
    setSecureUpdateNotice(detail,cp.phase==="FAILED");
  }
  return response;
}
async function testNativeUpdater({quiet=false}={}){
  secureUpdater.busy=true;renderSecureUpdater();
  try{
    const response=await chrome.runtime.sendMessage({type:"AI_BRIDGE_UPDATE_NATIVE_PING"});
    secureUpdater.pinged=true;
    if(response?.ok!==true){
      secureUpdater.hostConnected=false;
      secureUpdater.hostName="";
      secureUpdater.schema=null;
      secureUpdater.releaseConfigured=null;
      secureUpdater.releaseReady=false;
      secureUpdater.algorithm="";
      secureUpdater.keyBits=0;
      secureUpdater.checkedTarget=null;
      if(!quiet)setSecureUpdateNotice("Updater host unavailable: "+secureUpdateError(response,"Native updater is not installed or unavailable."),true);
      return response;
    }
    const verification=response.release_verification&&typeof response.release_verification==="object"
      ? response.release_verification:{};
    secureUpdater.hostConnected=true;
    secureUpdater.hostName=String(response.host||"");
    secureUpdater.schema=response.schema??null;
    secureUpdater.releaseConfigured=verification.configured===true;
    secureUpdater.releaseReady=verification.ready===true;
    secureUpdater.algorithm=String(verification.algorithm||"");
    secureUpdater.keyBits=Number.isInteger(Number(verification.key_bits))?Math.max(0,Number(verification.key_bits)):0;
    if(!quiet){
      if(secureUpdater.releaseConfigured===false){
        setSecureUpdateNotice("Updater host connected. Release verification is not configured, so signed CHECK/APPLY remain disabled.");
      }else if(!secureUpdater.releaseReady){
        setSecureUpdateNotice("Updater host connected, but the release verification configuration is invalid.",true);
      }else{
        setSecureUpdateNotice("Updater host connected. Release verification is ready.");
      }
    }
    return response;
  }finally{
    secureUpdater.busy=false;renderSecureUpdater();
  }
}
async function checkSignedUpdate(){
  if(!secureUpdater.hostConnected||!secureUpdater.releaseReady)throw new Error("Release verification must be ready before checking a signed update.");
  secureUpdater.busy=true;renderSecureUpdater();
  try{
    setSecureUpdateNotice("Checking the signed update manifest…");
    const response=await chrome.runtime.sendMessage({type:"AI_BRIDGE_UPDATE_NATIVE_CHECK"});
    if(response?.ok!==true)throw new Error(secureUpdateError(response,"Signed update check failed."));
    const available=response.available;
    const version=String(available?.version||"").trim();
    const build=String(available?.build||"").trim();
    const files=Number(available?.files);
    if(!version||version.length>128||!build||build.length>128||!Number.isInteger(files)||files<1||files>10000){
      throw new Error("Native updater returned an invalid signed update target.");
    }
    secureUpdater.checkedTarget=Object.freeze({version,build,files});
    setSecureUpdateNotice(targetMatchesInstalled(secureUpdater.checkedTarget)
      ?"The signed update target matches the installed build."
      :"Signed update verified and ready to prepare.");
    return response;
  }finally{
    secureUpdater.busy=false;renderSecureUpdater();
  }
}
async function prepareNativeUpdate(){
  const target=secureUpdater.checkedTarget;
  if(!target)throw new Error("Check a signed update before preparing it.");
  if(targetMatchesInstalled(target))throw new Error("The signed target is already installed.");
  await refreshNativeUpdateStatus({quiet:true});
  if(checkpointIsActive(secureUpdater.checkpoint))throw new Error("An update transaction is already active.");
  secureUpdater.busy=true;renderSecureUpdater();
  try{
    const response=await chrome.runtime.sendMessage({
      type:"AI_BRIDGE_UPDATE_PREPARE",
      targetVersion:target.version,
      targetBuild:target.build
    });
    if(response?.ok!==true)throw new Error(secureUpdateError(response,"Could not prepare the update checkpoint."));
    secureUpdater.checkpoint=response.checkpoint||secureUpdater.checkpoint;
    setSecureUpdateNotice(response.ready
      ?"Safe update point reached."
      :"Update prepared. Waiting for the current AI action to finish safely…");
    return response;
  }finally{
    secureUpdater.busy=false;
    await refreshNativeUpdateStatus({quiet:true}).catch(()=>{});
    renderSecureUpdater();
  }
}
async function applyNativeUpdate(){
  await refreshNativeUpdateStatus({quiet:true});
  if(secureUpdater.checkpoint?.phase!=="CHECKPOINTED")throw new Error("Apply is allowed only after a durable CHECKPOINTED update state.");
  secureUpdater.busy=true;renderSecureUpdater();
  setSecureUpdateNotice("Applying the signed update. AI Bridge will restart and rebind its AI tabs…");
  const response=await chrome.runtime.sendMessage({type:"AI_BRIDGE_UPDATE_NATIVE_APPLY"});
  if(response?.ok!==true){
    secureUpdater.busy=false;renderSecureUpdater();
    throw new Error(secureUpdateError(response,"Native update apply failed."));
  }
  return response;
}
async function cancelNativeUpdate(){
  await refreshNativeUpdateStatus({quiet:true});
  const cp=secureUpdater.checkpoint;
  if(!UPDATE_CANCELLABLE_PHASES.has(String(cp?.phase||"")))throw new Error("This update phase cannot be cancelled.");
  secureUpdater.busy=true;renderSecureUpdater();
  try{
    const response=await chrome.runtime.sendMessage({type:"AI_BRIDGE_UPDATE_CANCEL",checkpointId:String(cp.checkpointId||"")});
    if(response?.ok!==true)throw new Error(secureUpdateError(response,"Update cancellation failed."));
    secureUpdater.checkpoint=response.checkpoint||null;
    setSecureUpdateNotice("Update cancelled.");
    return response;
  }finally{
    secureUpdater.busy=false;
    await refreshNativeUpdateStatus({quiet:true}).catch(()=>{});
    renderSecureUpdater();
  }
}
async function initializeSecureUpdater(){
  renderSecureUpdater();
  await testNativeUpdater({quiet:true});
  await refreshNativeUpdateStatus({quiet:true});
  if(!secureUpdater.hostConnected){
    setSecureUpdateNotice("Native updater is not installed or unavailable. Manual ZIP fallback remains available.",true);
  }else if(secureUpdater.releaseConfigured===false){
    setSecureUpdateNotice("Updater host connected. Release verification is not configured; automatic update application remains securely disabled.");
  }else if(!secureUpdater.releaseReady){
    setSecureUpdateNotice("Updater host connected, but release verification is invalid; automatic update application remains disabled.",true);
  }else if(secureUpdater.checkpoint?.phase){
    const cp=secureUpdater.checkpoint;
    setSecureUpdateNotice(UPDATE_PHASE_TEXT[cp.phase]||String(cp.phase),cp.phase==="FAILED");
  }else{
    setSecureUpdateNotice("Updater host and release verification are ready.");
  }
  renderSecureUpdater();
}

async function checkUpdates(){
  $("updateStatus").textContent="Checking GitHub…";
  const res=await fetch("https://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json",{cache:"no-store"});if(!res.ok)throw new Error("GitHub manifest check failed.");
  const remote=await res.json(), current=chrome.runtime.getManifest().version;
  latestZipUrl="https://codeload.github.com/drkevorkian/AI_Bridge/zip/refs/heads/main";
  if(newer(remote.version,current)){$("updateStatus").textContent="Update available: v"+remote.version+" (installed v"+current+")";$("downloadUpdate").disabled=false;}
  else{$("updateStatus").textContent="Up to date: v"+current;$("downloadUpdate").disabled=true;}
}
async function init(){
  const manifest=chrome.runtime.getManifest();$("installedVersion").textContent="Version "+manifest.version;$("installedBuild").textContent="Build "+(manifest.version_name||manifest.version);$("updateVersion").textContent="Installed v"+manifest.version+" · "+(manifest.version_name||manifest.version);
  const local=await chrome.storage.local.get([THEME_KEY,LAYOUT_KEY,PANE_WIDTH_KEY,AUTO_UPDATE_KEY,KEEP_AWAKE_KEY,GOOGLE_CLIENT_KEY]);
  applyTheme(local[THEME_KEY]);await setLayout();
  const paneWidth=Math.min(70,Math.max(24,Number(local[PANE_WIDTH_KEY])||36));$("paneWidth").value=String(paneWidth);$("paneWidthValue").textContent=Math.round(paneWidth)+"%";
  $("autoCheckUpdates").checked=local[AUTO_UPDATE_KEY]===true;$("keepAwake").checked=local[KEEP_AWAKE_KEY]===true;$("powerStatus").textContent=local[KEEP_AWAKE_KEY]===true?"System awake":"Released";$("googleClientId").value=local[GOOGLE_CLIENT_KEY]||"";
  $("extensionId").textContent=chrome.runtime.id;$("redirectUri").textContent=chrome.identity.getRedirectURL("google");
  const sess=await chrome.storage.session.get(GOOGLE_TOKEN_KEY);$("googleStatus").textContent=sess[GOOGLE_TOKEN_KEY]?.accessToken?"Linked for this Chrome session":"Not linked";
}
function guarded(fn,notice){return async()=>{try{await fn()}catch(e){show(notice,e.message||String(e),true)}}}

$("settingsTheme").addEventListener("change",e=>setTheme(e.target.value));
$("paneWidth").addEventListener("input",e=>{$("paneWidthValue").textContent=e.target.value+"%";});
$("paneWidth").addEventListener("change",async e=>{const width=Math.min(70,Math.max(24,Number(e.target.value)||36));await chrome.storage.local.set({[PANE_WIDTH_KEY]:width});});
function navigateToExtensionPage(page){const url=chrome.runtime.getURL(page);if(window.location.href!==url)window.location.assign(url)}
$("openDashboard").addEventListener("click",()=>navigateToExtensionPage("dashboard.html"));
$("syncPush").addEventListener("click",guarded(syncPush,"syncNotice"));$("syncPull").addEventListener("click",guarded(syncPull,"syncNotice"));
$("saveGoogleClientId").addEventListener("click",guarded(async()=>{const v=$("googleClientId").value.trim();if(v&&!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(v))throw new Error("That does not look like a Google OAuth client ID.");await chrome.storage.local.set({[GOOGLE_CLIENT_KEY]:v});show("googleNotice","OAuth client ID saved locally.");},"googleNotice"));
$("googleLink").addEventListener("click",guarded(linkGoogle,"googleNotice"));$("googleUnlink").addEventListener("click",guarded(unlinkGoogle,"googleNotice"));$("drivePush").addEventListener("click",guarded(drivePush,"googleNotice"));$("drivePull").addEventListener("click",guarded(drivePull,"googleNotice"));
$("copyExtensionId").addEventListener("click",()=>navigator.clipboard.writeText($("extensionId").textContent));$("copyRedirectUri").addEventListener("click",()=>navigator.clipboard.writeText($("redirectUri").textContent));
$("refreshHealth").addEventListener("click",guarded(health,"syncNotice"));
$("keepAwake").addEventListener("change",guarded(async()=>{const enabled=$("keepAwake").checked;const r=await chrome.runtime.sendMessage({type:"AI_BRIDGE_POWER_SET",enabled});if(!r?.ok)throw new Error(r?.error||"Power setting failed.");$("powerStatus").textContent=enabled?"System awake":"Released";},"syncNotice"));
$("testNativeUpdater").addEventListener("click",guarded(()=>testNativeUpdater(),"secureUpdateNotice"));
$("checkSignedUpdate").addEventListener("click",guarded(checkSignedUpdate,"secureUpdateNotice"));
$("prepareNativeUpdate").addEventListener("click",guarded(prepareNativeUpdate,"secureUpdateNotice"));
$("applyNativeUpdate").addEventListener("click",guarded(applyNativeUpdate,"secureUpdateNotice"));
$("cancelNativeUpdate").addEventListener("click",guarded(cancelNativeUpdate,"secureUpdateNotice"));
$("checkUpdates").addEventListener("click",guarded(checkUpdates,"syncNotice"));$("downloadUpdate").addEventListener("click",guarded(async()=>{if(!latestZipUrl)await checkUpdates();await chrome.downloads.download({url:latestZipUrl,filename:"AI_Bridge-main.zip",saveAs:true});},"syncNotice"));
$("autoCheckUpdates").addEventListener("change",guarded(async()=>{const enabled=$("autoCheckUpdates").checked;await chrome.storage.local.set({[AUTO_UPDATE_KEY]:enabled});await chrome.runtime.sendMessage({type:"AI_BRIDGE_AUTO_UPDATE_SET",enabled});},"syncNotice"));
chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes[THEME_KEY])applyTheme(changes[THEME_KEY].newValue)});
init().then(async()=>{
  await health();
  await initializeSecureUpdater();
  window.setInterval(()=>{
    if(checkpointIsActive(secureUpdater.checkpoint)){
      refreshNativeUpdateStatus({quiet:true}).catch(()=>{});
    }
  },2000);
}).catch(e=>show("syncNotice",e.message,true));
