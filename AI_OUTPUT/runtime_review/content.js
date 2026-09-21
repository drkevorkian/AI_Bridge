(() => {
  "use strict";

  const manifest = chrome.runtime.getManifest();
  const CONTENT_BUILD = String(manifest.version_name || manifest.version || "unknown");
  const CONTENT_RUNTIME_SCHEMA = 1;
  const resident = globalThis.__AI_BRIDGE_CONTENT_RUNTIME__;

  if (resident) {
    if (
      resident.schema === CONTENT_RUNTIME_SCHEMA &&
      resident.build === CONTENT_BUILD &&
      resident.active === true
    ) return;

    if (
      resident.schema !== CONTENT_RUNTIME_SCHEMA ||
      typeof resident.dispose !== "function"
    ) {
      chrome.runtime.sendMessage({
        type: "AI_BRIDGE_CONTENT_RUNTIME_INCOMPATIBLE",
        residentBuild: String(resident.build || "unknown"),
        requestedBuild: CONTENT_BUILD
      }).catch(() => {});
      return;
    }

    try {
      resident.dispose("superseded");
    } catch (_) {
      chrome.runtime.sendMessage({
        type: "AI_BRIDGE_CONTENT_RUNTIME_INCOMPATIBLE",
        residentBuild: String(resident.build || "unknown"),
        requestedBuild: CONTENT_BUILD,
        reason: "DISPOSE_FAILED"
      }).catch(() => {});
      return;
    }
  } else if (globalThis.__AI_BRIDGE_REVIEW_CONTENT__ === true) {
    // The legacy boolean-only runtime did not retain observer/timer/listener
    // handles, so it cannot be safely replaced without reloading the host page.
    chrome.runtime.sendMessage({
      type: "AI_BRIDGE_CONTENT_RUNTIME_INCOMPATIBLE",
      residentBuild: "legacy-boolean-runtime",
      requestedBuild: CONTENT_BUILD,
      reason: "LEGACY_RUNTIME_NOT_DISPOSABLE"
    }).catch(() => {});
    return;
  }

  const VERSION = CONTENT_BUILD;
  const host = location.hostname.toLowerCase();
  const provider = host === "chatgpt.com" || host === "chat.openai.com" ? "chatgpt"
    : host === "grok.com" ? "grok"
    : host === "claude.ai" ? "claude"
    : host === "gemini.google.com" ? "gemini"
    : host === "copilot.microsoft.com" ? "copilot"
    : null;

  const TRUSTED = Object.freeze({
    chatgpt: Object.freeze({
      composer: Object.freeze(["#prompt-textarea"]),
      send: Object.freeze(["button[data-testid='send-button']","button[aria-label='Send prompt']","button#composer-submit-button"]),
      response: Object.freeze(["[data-message-author-role='assistant'] .markdown","[data-message-author-role='assistant']"])
    }),
    grok: Object.freeze({
      composer: Object.freeze([
        "div.ProseMirror[data-testid='chat-input'][contenteditable='true'][role='textbox']",
        "[data-testid='chat-input'] div.ProseMirror[contenteditable='true'][role='textbox']",
        "div.ProseMirror[contenteditable='true'][role='textbox'][aria-label*='Grok']",
        "textarea[placeholder*='Ask']",
        "div[contenteditable='true'][aria-label*='Grok']"
      ]),
      send: Object.freeze([
        "button[data-testid='send-button']",
        "button[aria-label='Send message']",
        "button[aria-label='Send']",
        "button[aria-label='Submit']"
      ]),
      response: Object.freeze(["[data-testid='assistant-message']","[data-testid='message-text']"])
    }),
    gemini: Object.freeze({
      composer: Object.freeze(["rich-textarea div[contenteditable='true']"]),
      send: Object.freeze(["button[aria-label='Send message']"]),
      response: Object.freeze(["message-content"])
    }),
    claude: Object.freeze({ composer:Object.freeze([]), send:Object.freeze(["button[aria-label='Send Message']"]), response:Object.freeze([]) }),
    copilot: Object.freeze({ composer:Object.freeze(["textarea#searchbox"]), send:Object.freeze([]), response:Object.freeze(["cib-message"]) })
  });

  const config = TRUSTED[provider] || { composer:[], send:[], response:[] };
  const byCommand = new Map();
  const byAuthority = new Map();
  const MAX_CACHE = 128;
  let registration = null;
  let lastHref = location.href;
  let awaitingDispatchId = null;
  let awaitingResponseContext = null;
  let awaitingResponseBaselineNode = null;
  let awaitingResponseBaselineText = "";
  let lastResponseSignature = "";
  let lastObserved = "";
  let lastObservedNode = null;
  let lastChangedAt = 0;
  let monitorTimer = null;
  let lastLimitSignature = "";
  let providerEventBaseline = new Set();
  const providerEventSignatures = new Map();
  let routeTimer = null;
  let disposed = false;
  let pendingResponseDelivery = null;
  let responseDeliveryTimer = null;
  let responseDeliveryInFlight = false;
  let responseDeliveryAttempts = 0;

  function trim(map){ while(map.size > MAX_CACHE) map.delete(map.keys().next().value); }
  function rememberCommand(command,result){ byCommand.set(command.commandId,result); trim(byCommand); return result; }
  function consumeAuthority(command,result){ rememberCommand(command,result); byAuthority.set(command.action+":"+command.authorityId,result); trim(byAuthority); return result; }
  function sameIdentity(a,b){
    if(!a||!b) return false;
    return ["provider","kind","routeClass","threadKey","provisional","writable"].every(k => String(a[k] ?? "") === String(b[k] ?? ""));
  }
  function visible(node){
    if(!node || node.isConnected===false) return false;
    const r=node.getBoundingClientRect(); if(!r || r.width<=0 || r.height<=0) return false;
    const s=getComputedStyle(node); return s.visibility!=="hidden" && s.display!=="none" && !node.hasAttribute("hidden");
  }
  function enabled(node){ return visible(node) && node.disabled!==true && node.getAttribute("aria-disabled")!=="true"; }
  function resolveTrusted(selectors,{requireEnabled=false}={}){
    const nodes=[];
    for(const selector of selectors||[]){
      let matches=[]; try{ matches=[...document.querySelectorAll(selector)].filter(n => requireEnabled ? enabled(n) : visible(n)); }catch(_){}
      if(matches.length!==1) continue;
      if(!nodes.includes(matches[0])) nodes.push(matches[0]);
    }
    return nodes.length===1 ? nodes[0] : null;
  }
  function trustedSelectorStats(selectors){
    const matched=new Set();
    const visibleNodes=new Set();
    const enabledNodes=new Set();
    for(const selector of selectors||[]){
      let nodes=[];
      try{ nodes=[...document.querySelectorAll(selector)]; }catch(_){}
      for(const node of nodes){
        matched.add(node);
        if(visible(node)) visibleNodes.add(node);
        if(enabled(node)) enabledNodes.add(node);
      }
    }
    return Object.freeze({
      matched:matched.size,
      visible:visibleNodes.size,
      enabled:enabledNodes.size
    });
  }
  function grokComposerSubmissionForm(composer){
    if(provider!=="grok" || !composer?.isConnected) return null;
    const chatInput=composer.closest?.("[data-testid='chat-input']")||null;
    if(!chatInput || !chatInput.contains(composer)) return null;
    const form=composer.closest?.("form")||null;
    if(!form || !form.contains(chatInput)) return null;
    return form;
  }
  function resolveTrustedSend(composer,{requireEnabled=false}={}){
    const semantic=resolveTrusted(config.send,{requireEnabled});
    if(semantic) return Object.freeze({kind:"button",node:semantic,form:null});

    // Grok changes localized/accessible labels frequently. Permit one narrowly
    // scoped structural fallback only inside the exact verified chat-input form.
    // A generic page-wide submit button never gains SEND authority.
    const form=grokComposerSubmissionForm(composer);
    if(!form) return null;
    let submits=[];
    try{
      submits=[...form.querySelectorAll("button[type='submit']")]
        .filter(node=>requireEnabled?enabled(node):visible(node));
    }catch(_){ submits=[]; }
    if(submits.length===1) return Object.freeze({kind:"button",node:submits[0],form});
    if(submits.length===0 && typeof form.requestSubmit==="function"){
      return Object.freeze({kind:"requestSubmit",node:null,form});
    }
    return null;
  }
  function trustedSendStats(composer){
    const semantic=trustedSelectorStats(config.send);
    const form=grokComposerSubmissionForm(composer);
    let scopedMatched=0,scopedVisible=0,scopedEnabled=0;
    if(form){
      let nodes=[];
      try{nodes=[...form.querySelectorAll("button[type='submit']")];}catch(_){}
      scopedMatched=nodes.length;
      scopedVisible=nodes.filter(visible).length;
      scopedEnabled=nodes.filter(enabled).length;
    }
    return Object.freeze({
      ...semantic,
      scopedSubmitMatched:scopedMatched,
      scopedSubmitVisible:scopedVisible,
      scopedSubmitEnabled:scopedEnabled,
      requestSubmit:Boolean(form&&typeof form.requestSubmit==="function")
    });
  }
  function routeIdentity(){
    const path=location.pathname;
    let threadKey=null;
    const patterns = provider==="chatgpt" ? [/^\/c\/([^/?#]+)/]
      : provider==="grok" ? [/^\/(?:c|chat)\/([^/?#]+)/]
      : provider==="claude" ? [/^\/chat\/([^/?#]+)/]
      : provider==="gemini" ? [/^\/app\/([^/?#]+)/]
      : provider==="copilot" ? [/^\/(?:chats?|conversation)\/([^/?#]+)/]
      : [];
    for(const re of patterns){ const m=path.match(re); if(m){threadKey=decodeURIComponent(m[1]);break;} }
    if(threadKey) return Object.freeze({provider,kind:"conversation",routeClass:"conversation",threadKey,provisional:false,writable:true});
    return Object.freeze({provider,kind:"surface",routeClass:"new_chat_surface",threadKey:null,provisional:true,writable:true});
  }
  function capabilities(){
    return Object.freeze({
      composer: resolveTrusted(config.composer) ? "PASS" : "FAIL",
      // Some provider UIs (including ChatGPT) render Send only after draft input.
      // Composer authority + a pinned trusted Send selector contract is enough
      // to declare the send path probeable; performSend proves the actual
      // actionable Send element after inserting the draft.
      send: (resolveTrusted(config.send) || (resolveTrusted(config.composer) && config.send.length)) ? "PASS" : "FAIL",
      response: config.response.length ? "PASS" : "UNSUPPORTED",
      provider_events: "PASS",
      upload: "UNSUPPORTED",
      new_chat: "UNSUPPORTED",
      conversation_identity: provider ? "PASS" : "FAIL"
    });
  }
  function getComposerText(node){ return "value" in node ? String(node.value||"") : String(node.innerText||node.textContent||""); }
  function setComposerText(node,text){
    node.focus();
    if(node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement){
      const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
      if(setter) setter.call(node,text); else node.value=text;
      node.dispatchEvent(new Event("input",{bubbles:true}));
      node.dispatchEvent(new Event("change",{bubbles:true}));
      return;
    }
    if(node.isContentEditable){
      const value=String(text);
      let inserted=false;

      // ChatGPT's #prompt-textarea is a ProseMirror contenteditable editor.
      // Direct DOM replacement can make text visible without advancing the
      // editor's internal state, leaving Send disabled. Prefer Chromium's
      // native editing pipeline so the provider receives a real edit
      // transaction for the already-proven trusted composer.
      try{
        const selection=window.getSelection();
        if(selection){
          const range=document.createRange();
          range.selectNodeContents(node);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        const insertSupported=typeof document.queryCommandSupported!=="function" ||
          document.queryCommandSupported("insertText");
        if(insertSupported && typeof document.execCommand==="function"){
          inserted=document.execCommand("insertText",false,value)===true;
        }
      }catch(_){ inserted=false; }

      if(inserted && getComposerText(node).trim()===value.trim()) return;

      // Bounded compatibility fallback for providers/browsers where the native
      // editing command is unavailable. performSend still refuses to click
      // until the pinned Send authority becomes uniquely actionable.
      node.replaceChildren();
      const lines=value.split("\n");
      lines.forEach((line,index)=>{if(index)node.appendChild(document.createElement("br"));node.appendChild(document.createTextNode(line));});
      node.dispatchEvent(new InputEvent("input",{
        bubbles:true,
        cancelable:true,
        composed:true,
        inputType:"insertText",
        data:value
      }));
      node.dispatchEvent(new Event("change",{bubbles:true,composed:true}));
      return;
    }
    throw new Error("TRUSTED_COMPOSER_NOT_EDITABLE");
  }
  async function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
  async function waitForTrusted(selectors,{requireEnabled=false,attempts=40,delayMs=75}={}){
    const boundedAttempts=Math.max(1,Math.min(80,Number(attempts)||1));
    const boundedDelay=Math.max(0,Math.min(250,Number(delayMs)||0));
    for(let i=0;i<boundedAttempts;i++){
      const node=resolveTrusted(selectors,{requireEnabled});
      if(node) return node;
      if(i+1<boundedAttempts && boundedDelay>0) await sleep(boundedDelay);
    }
    return null;
  }
  async function confirmSend(composer,originalText){
    for(let i=0;i<20;i++){
      await sleep(125);
      const current=getComposerText(composer).trim();
      if(!current) return {confirmed:true,evidence:"composer-cleared"};
      if(current!==String(originalText).trim() && current.length < String(originalText).trim().length/2) return {confirmed:true,evidence:"composer-transition"};
    }
    return {confirmed:false,evidence:null};
  }
  function reject(command,reason,detail=null){
    return Object.freeze({ok:false,outcome:"REJECTED_PRE_ACTION",reason,commandId:String(command?.commandId||""),authorityId:String(command?.authorityId||""),detail});
  }

  async function performSend(command){
    if(!registration || command.authorityRegistrationId!==registration.authorityRegistrationId || Number(command.generationEpoch)!==registration.generationEpoch) {
      return rememberCommand(command,reject(command,"STALE_AUTHORITY_REGISTRATION"));
    }
    const liveIdentity=routeIdentity();
    if(!sameIdentity(liveIdentity,command.expectedIdentity) || !sameIdentity(liveIdentity,registration.identity)) {
      return rememberCommand(command,reject(command,"STALE_CONVERSATION_AUTHORITY"));
    }
    const artifacts=Array.isArray(command.payload?.artifacts)?command.payload.artifacts:[];
    if(artifacts.length) return rememberCommand(command,reject(command,"UPLOAD_UNSUPPORTED"));

    // Security boundary, phase 1: prove only the stable composer before typing.
    // Fresh/new provider surfaces can mount the trusted editor asynchronously.
    // Wait only for the already-pinned selectors; never broaden authority to a
    // generic textbox. Re-prove route identity after the bounded mount window.
    const composer1=await waitForTrusted(config.composer,{attempts:80,delayMs:100});
    if(!composer1){
      const stats=trustedSelectorStats(config.composer);
      const detail=`COMPOSER provider=${provider}; matched=${stats.matched}; visible=${stats.visible}; enabled=${stats.enabled}`;
      return rememberCommand(command,reject(command,"DOM_AUTHORITY_UNAVAILABLE",detail));
    }
    const identityAfterComposerWait=routeIdentity();
    if(!sameIdentity(identityAfterComposerWait,command.expectedIdentity) || !sameIdentity(identityAfterComposerWait,registration.identity)) {
      return rememberCommand(command,reject(command,"STALE_CONVERSATION_AUTHORITY"));
    }
    const composer2=resolveTrusted(config.composer);
    if(composer1!==composer2 || !composer2?.isConnected) {
      return rememberCommand(command,reject(command,"DOM_AUTHORITY_CHANGED","COMPOSER"));
    }

    const text=String(command.payload?.text||"");
    if(!text.trim()) return rememberCommand(command,reject(command,"EMPTY_PROMPT"));
    setComposerText(composer2,text);

    // Security boundary, phase 2: after draft insertion, require one unique,
    // visible, enabled Send element matching only the pinned trusted selectors.
    // This covers providers that create/enable Send asynchronously.
    let sendAction=null;
    for(let i=0;i<80;i++){
      await sleep(i===0?120:100);
      const composerNow=resolveTrusted(config.composer);
      if(composerNow!==composer2 || !composer2?.isConnected) {
        return rememberCommand(command,reject(command,"DOM_AUTHORITY_CHANGED","COMPOSER"));
      }
      const candidate=resolveTrustedSend(composer2,{requireEnabled:true});
      if(candidate){
        sendAction=candidate;
        break;
      }
    }
    if(!sendAction){
      const stats=trustedSendStats(composer2);
      const composerChars=getComposerText(composer2).length;
      const detail=`SEND provider=${provider}; composerChars=${composerChars}; matched=${stats.matched}; visible=${stats.visible}; enabled=${stats.enabled}; scopedSubmitMatched=${stats.scopedSubmitMatched}; scopedSubmitVisible=${stats.scopedSubmitVisible}; scopedSubmitEnabled=${stats.scopedSubmitEnabled}; requestSubmit=${stats.requestSubmit?1:0}`;
      return rememberCommand(command,reject(command,"DOM_AUTHORITY_NOT_ACTIONABLE",detail));
    }

    // Re-prove identity after provider React/SPA DOM updates caused by typing.
    const identityAfterDraft=routeIdentity();
    if(!sameIdentity(identityAfterDraft,command.expectedIdentity) || !sameIdentity(identityAfterDraft,registration.identity)) {
      return rememberCommand(command,reject(command,"STALE_CONVERSATION_AUTHORITY"));
    }

    const sendAgain=resolveTrustedSend(composer2,{requireEnabled:true});
    const sameSendAction=Boolean(
      sendAgain &&
      sendAgain.kind===sendAction.kind &&
      sendAgain.node===sendAction.node &&
      sendAgain.form===sendAction.form &&
      (!sendAgain.node || sendAgain.node.isConnected)
    );
    if(!sameSendAction) {
      return rememberCommand(command,reject(command,"DOM_AUTHORITY_CHANGED","SEND"));
    }

    const attempted=Object.freeze({ok:false,outcome:"ACTION_ATTEMPTED",reason:"ACTION_CONFIRMATION_NOT_PROVEN",commandId:command.commandId,authorityId:command.authorityId});
    consumeAuthority(command,attempted);
    captureProviderEventBaseline();
    const responseBaseline=responseObservation();
    const responseBaselineObservedAt=Date.now();
    const responseBaselineIdentity=identityAfterDraft;
    awaitingResponseBaselineNode=responseBaseline.node;
    awaitingResponseBaselineText=responseBaseline.text;
    lastObserved="";
    lastObservedNode=null;
    lastChangedAt=Date.now();
    if(sendAgain.kind==="button"){
      sendAgain.node.click();
    }else{
      // Current Grok can omit a stable Send-button identity while retaining the
      // exact chat form. requestSubmit invokes that verified form's native
      // submit path without broadening authority to unrelated page controls.
      sendAgain.form.requestSubmit();
    }
    awaitingDispatchId=command.authorityId;
    awaitingResponseContext=Object.freeze({
      dispatchId:String(command.authorityId),
      side:String(command.side||registration.side||"").toUpperCase(),
      generationEpoch:Number(command.generationEpoch),
      provider,
      authorityRegistrationId:String(command.authorityRegistrationId||""),
      rolloverId:command.rolloverId==null?null:String(command.rolloverId),
      preSendAssistantText:String(responseBaseline.text||"").slice(0,200000),
      preSendAssistantObservedAt:responseBaselineObservedAt,
      preSendAssistantIdentity:responseBaselineIdentity
    });
    const confirmation=await confirmSend(composer2,text);
    if(!confirmation.confirmed) return attempted;
    return consumeAuthority(command,Object.freeze({
      ok:true,
      outcome:"ACTION_CONFIRMED",
      reason:null,
      commandId:command.commandId,
      authorityId:command.authorityId,
      evidence:confirmation.evidence,
      side:String(command.side||registration?.side||"").toUpperCase(),
      generationEpoch:Number(command.generationEpoch),
      conversationIdentity:identityAfterDraft,
      rolloverId:command.rolloverId==null?null:String(command.rolloverId)
    }));
  }

  async function handleAction(raw){
    let command;
    try{
      const action=String(raw?.action||"").toUpperCase();
      const authorityId=String(raw?.dispatchId||raw?.rolloverId||raw?.authorityId||"").trim();
      const commandId=String(raw?.commandId||"").trim();
      if(!commandId||!authorityId) throw new Error("INVALID_COMMAND");
      command={...raw,action,authorityId,commandId};
    }catch(error){ return reject(raw,"INVALID_COMMAND",error.message); }
    const duplicate=byCommand.get(command.commandId)||byAuthority.get(command.action+":"+command.authorityId);
    if(duplicate) return Object.freeze({...duplicate,duplicate:true,reason:"DUPLICATE_COMMAND"});
    if(command.action==="SEND") return performSend(command);
    return rememberCommand(command,reject(command,"UNSUPPORTED_ACTION"));
  }

  function normalizeProviderEventText(value){
    return String(value||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim().slice(0,500);
  }
  function classifyProviderEvent(value){
    const text=normalizeProviderEventText(value);
    if(!text) return null;
    if(/maximum length for this conversation|you(?:'|’)ve reached the maximum length for this conversation/i.test(text)) return null;
    const rules=[
      ["MESSAGE_DELIVERY_TIMEOUT","DELIVERY","RECOVERABLE",/message delivery timed out(?:\.|$)|delivery timed out(?:\.|$)/i],
      ["CONNECTION_INTERRUPTED","CONNECTION","RECOVERABLE",/connection interrupted|connection lost|disconnected|reconnecting|waiting for (?:the )?complete answer/i],
      ["NETWORK_ERROR","CONNECTION","RECOVERABLE",/network error|network issue|network connection/i],
      ["GENERATION_ERROR","GENERATION","RECOVERABLE",/something went wrong|error generating|failed to generate|could(?:n|'|’)t generate|generation failed/i],
      ["RATE_LIMIT","CAPACITY","RECOVERABLE",/rate limit|too many requests/i],
      ["USAGE_LIMIT","CAPACITY","RECOVERABLE",/usage limit|try again in \d|limit resets/i],
      ["AUTH_REQUIRED","AUTH","BLOCKING",/session expired|sign in to continue|log in to continue|authentication required/i],
      ["CONTENT_BLOCKED","POLICY","BLOCKING",/content blocked|response blocked by|blocked by policy/i]
    ];
    for(const [code,category,severity,re] of rules){
      if(re.test(text)) return Object.freeze({code,category,severity,message:text});
    }
    return null;
  }
  function operationalEventTexts(){
    const texts=[];
    for(const selector of ["[role='alert']","[aria-live='assertive']","[aria-live='polite']"]){
      let nodes=[]; try{nodes=[...document.querySelectorAll(selector)].filter(node=>visible(node)&&!node.closest("[data-message-author-role='assistant'],[data-message-author-role=\"assistant\"]"))}catch(_){}
      for(const node of nodes){
        const text=normalizeProviderEventText(node.innerText||node.textContent||"");
        if(text&&!texts.includes(text)) texts.push(text);
      }
    }
    return texts;
  }
  function captureProviderEventBaseline(){
    providerEventBaseline=new Set(operationalEventTexts());
  }
  async function inspectProviderEvent(){
    if(!awaitingDispatchId||!registration) return null;
    const candidates=operationalEventTexts();
    for(const raw of candidates){
      const event=classifyProviderEvent(raw);
      if(!event) continue;
      if(providerEventBaseline.has(event.message)) continue;
      const identity=registration.identity||{};
      const signature=[provider,awaitingDispatchId,event.code,event.message,identity.threadKey||identity.routeClass||""].join("::");
      if(!providerEventSignatures.has(signature)){
        providerEventSignatures.set(signature,Date.now());
        trim(providerEventSignatures);
        try{
          await chrome.runtime.sendMessage({
            type:"AI_BRIDGE_PROVIDER_EVENT",
            provider,
            dispatchId:awaitingDispatchId,
            generationEpoch:registration.generationEpoch,
            authorityRegistrationId:registration.authorityRegistrationId,
            conversationIdentity:registration.identity,
            side:registration.side,
            code:event.code,
            message:event.message,
            observedAt:Date.now()
          });
        }catch(_){}
      }
      return event;
    }
    return null;
  }

  function latestExchangeObservation(){
    if(provider!=="chatgpt") return {userText:"",assistantText:"",assistantAfterUser:false};
    const users=[...document.querySelectorAll("[data-message-author-role='user']")].filter(visible);
    const user=users[users.length-1]||null;
    const assistant=responseObservation();
    const userText=user?String(user.innerText||user.textContent||"").replace(/\u00a0/g," ").trim():"";
    const assistantText=String(assistant.text||"").trim();
    const assistantAfterUser=Boolean(
      user&&assistant.node&&
      typeof user.compareDocumentPosition==="function"&&
      (user.compareDocumentPosition(assistant.node)&4)
    );
    return {userText,assistantText,assistantAfterUser};
  }
  function clearPendingResponseDelivery(dispatchId=null){
    if(dispatchId!=null&&pendingResponseDelivery?.envelope?.dispatchId!==String(dispatchId)) return false;
    pendingResponseDelivery=null;
    responseDeliveryAttempts=0;
    if(responseDeliveryTimer!==null){clearTimeout(responseDeliveryTimer);responseDeliveryTimer=null;}
    return true;
  }
  function scheduleResponseDelivery(ms=250){
    if(disposed||!pendingResponseDelivery||responseDeliveryTimer!==null) return;
    const delay=Math.max(0,Math.min(5000,Number(ms)||0));
    responseDeliveryTimer=setTimeout(()=>{
      responseDeliveryTimer=null;
      if(disposed) return;
      deliverPendingResponse().catch(()=>{});
    },delay);
  }
  async function deliverPendingResponse(){
    if(disposed||responseDeliveryInFlight||!pendingResponseDelivery) return;
    responseDeliveryInFlight=true;
    const pending=pendingResponseDelivery;
    let acknowledgement=null;
    try{ acknowledgement=await chrome.runtime.sendMessage(pending.envelope); }
    catch(_){}
    finally{ responseDeliveryInFlight=false; }
    if(pendingResponseDelivery!==pending) return;
    if(acknowledgement?.durableResponseAccepted===true){
      const dispatchId=String(pending.envelope.dispatchId||"");
      clearPendingResponseDelivery(dispatchId);
      if(awaitingDispatchId===dispatchId){
        awaitingDispatchId=null;
        awaitingResponseContext=null;
        awaitingResponseBaselineNode=null;
        awaitingResponseBaselineText="";
      }
      return;
    }
    responseDeliveryAttempts=Math.min(responseDeliveryAttempts+1,1000000);
    const backoff=Math.min(5000,250*(2**Math.min(responseDeliveryAttempts,4)));
    scheduleResponseDelivery(backoff);
  }

  function responseObservation(){
    const nodes=[];
    for(const selector of config.response||[]){
      try{ for(const node of document.querySelectorAll(selector)) if(visible(node)&&!nodes.includes(node)) nodes.push(node); }catch(_){}
    }
    const node=nodes[nodes.length-1]||null;
    const text=node?String(node.innerText||node.textContent||"").replace(/\u00a0/g," ").trim():"";
    return {node,text};
  }
  function responseText(){ return responseObservation().text; }
  function generationActive(){
    const stopSelectors=provider==="chatgpt"?["button[data-testid='stop-button']","button[aria-label='Stop generating']"]
      :provider==="grok"?["button[aria-label='Stop']"]
      :provider==="gemini"?["button[aria-label*='Stop']"]:[];
    return Boolean(resolveTrusted(stopSelectors,{requireEnabled:true}));
  }
  async function monitor(){
    monitorTimer=null;
    if(pendingResponseDelivery){scheduleResponseDelivery(0);return;}
    if(!awaitingDispatchId) return;
    if(await inspectProviderEvent()){scheduleMonitor(750);return;}
    const observation=responseObservation();
    const text=observation.text;
    if(!text) return;
    if(
      observation.node===awaitingResponseBaselineNode &&
      text===awaitingResponseBaselineText
    ){
      scheduleMonitor(350);
      return;
    }
    if(text!==lastObserved || observation.node!==lastObservedNode){
      lastObserved=text;
      lastObservedNode=observation.node;
      lastChangedAt=Date.now();
      // Once a different response node/text exists, the old-response baseline
      // has served its purpose. From this point onward, stability is measured
      // against the previous OBSERVATION, not the cleared pre-send baseline.
      // Comparing against awaitingResponseBaselineNode after clearing it to
      // null causes every subsequent poll to look changed forever.
      awaitingResponseBaselineNode=null;
      awaitingResponseBaselineText="";
      scheduleMonitor(350);
      return;
    }
    if(generationActive() || Date.now()-lastChangedAt<1600){scheduleMonitor(350);return;}
    const signature=awaitingDispatchId+"::"+text;
    if(signature===lastResponseSignature && pendingResponseDelivery){scheduleResponseDelivery(0);return;}
    lastResponseSignature=signature;
    const dispatchId=awaitingDispatchId;
    const responseContext=awaitingResponseContext && awaitingResponseContext.dispatchId===dispatchId
      ? awaitingResponseContext
      : (registration ? Object.freeze({
          dispatchId,
          side:registration.side,
          generationEpoch:registration.generationEpoch,
          provider:registration.provider,
          authorityRegistrationId:registration.authorityRegistrationId,
          rolloverId:null
        }) : null);
    if(!responseContext) return;
    const liveIdentity=routeIdentity();
    if(liveIdentity.provider!==responseContext.provider || liveIdentity.writable!==true){
      scheduleMonitor(500);
      return;
    }
    pendingResponseDelivery=Object.freeze({
      envelope:Object.freeze({
        type:"AI_BRIDGE_RESPONSE",
        text,
        completedAt:Date.now(),
        dispatchId,
        generationEpoch:responseContext.generationEpoch,
        conversationIdentity:liveIdentity,
        side:responseContext.side,
        rolloverId:responseContext.rolloverId,
        artifacts:[]
      })
    });
    responseDeliveryAttempts=0;
    scheduleResponseDelivery(0);
  }
  function scheduleMonitor(ms=250){
    if(disposed || monitorTimer) return;
    monitorTimer=setTimeout(()=>{
      monitorTimer=null;
      if(disposed) return;
      monitor().catch(()=>{});
    },ms);
  }


  function inspectThreadLimit(){
    if(provider!=="chatgpt") return;
    const regions=[...document.querySelectorAll("[role='alert'],[aria-live='assertive'],[aria-live='polite']")].filter(node=>visible(node)&&!node.closest("[data-message-author-role]"));
    for(const node of regions){
      const text=String(node.innerText||node.textContent||"").replace(/\s+/g," ").trim();
      if(!text) continue;
      if(/usage limit|rate limit|try again in|upload limit|network error|something went wrong/i.test(text)) continue;
      if(!/maximum length for this conversation|you(?:'|’)ve reached the maximum length for this conversation/i.test(text)) continue;
      const signature=text.slice(0,500);
      const limitSignatureKey=String(awaitingDispatchId||"none")+"::"+signature;
      if(limitSignatureKey===lastLimitSignature) return;
      if(!registration) return;
      const liveIdentity=routeIdentity();
      if(!sameIdentity(liveIdentity,registration.identity)) return;
      const composer=resolveTrusted(config.composer);
      lastLimitSignature=limitSignatureKey;
      chrome.runtime.sendMessage({
        type:"AI_BRIDGE_THREAD_LIMIT",
        provider,
        text:signature,
        regions:[{kind:"provider-notice",text:signature,visible:true}],
        composer:{present:Boolean(composer),disabled:Boolean(composer&&!enabled(composer))},
        dispatchId:awaitingDispatchId,
        side:registration.side,
        generationEpoch:registration.generationEpoch,
        authorityRegistrationId:registration.authorityRegistrationId,
        conversationIdentity:liveIdentity,
        observedAt:Date.now(),
        preSendAssistantText:String(awaitingResponseContext?.preSendAssistantText||"").slice(0,200000),
        preSendAssistantObservedAt:Number(awaitingResponseContext?.preSendAssistantObservedAt)||null,
        preSendAssistantIdentity:awaitingResponseContext?.preSendAssistantIdentity||null
      }).catch(()=>{});
      return;
    }
  }

  const observer=new MutationObserver(()=>{
    if(disposed) return;
    scheduleMonitor();
    inspectThreadLimit();
    inspectProviderEvent().catch(()=>{});
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["disabled","aria-disabled","data-state","aria-label","data-testid"]});

  routeTimer=setInterval(()=>{
    if(location.href!==lastHref){
      lastHref=location.href;
      registration=null;
      if(!awaitingResponseContext) awaitingDispatchId=null;
      lastLimitSignature="";
      providerEventBaseline=new Set();
      providerEventSignatures.clear();
      // Keep the bounded UUID-keyed action cache across same-document SPA route
      // changes. Registration is still revoked above, so cached results cannot
      // authorize a new action; they only prove/deduplicate an action that was
      // already executed before a worker restart.
      chrome.runtime.sendMessage({type:"AI_BRIDGE_DOCUMENT_ROUTE_CHANGED"}).catch(()=>{});
    }
    scheduleMonitor();
    inspectThreadLimit();
    inspectProviderEvent().catch(()=>{});
  },750);

  const onRuntimeMessage=(msg,_sender,sendResponse)=>{
    if(msg.type==="AI_BRIDGE_PING"){
      sendResponse({ok:true,host,provider,ready:true,version:VERSION,capabilities:capabilities(),identity:routeIdentity()});
      return false;
    }
    if(msg.type==="AI_BRIDGE_IDENTITY_PROBE"){
      try{sendResponse({ok:true,identity:routeIdentity(),capabilities:capabilities()});}
      catch(error){sendResponse({ok:false,error:error.message||String(error)});}
      return false;
    }
    if(msg.type==="AI_BRIDGE_REGISTER_DOCUMENT"){
      (async()=>{
        const currentIdentity=routeIdentity();
        const result=await chrome.runtime.sendMessage({
          type:"AI_BRIDGE_DOCUMENT_REGISTER",
          side:msg.side,
          provider:msg.provider,
          generationEpoch:msg.generationEpoch,
          nonce:msg.nonce,
          authorityRegistrationId:msg.authorityRegistrationId,
          currentIdentity
        });
        if(!result?.ok) throw new Error(result?.error||"Document registration failed.");
        registration=Object.freeze({
          side:String(msg.side||"").toUpperCase(),
          provider:String(msg.provider||"").toLowerCase(),
          generationEpoch:Number(msg.generationEpoch),
          authorityRegistrationId:String(msg.authorityRegistrationId||""),
          identity:currentIdentity
        });
        return {ok:true,registered:true};
      })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message||String(error)}));
      return true;
    }
    if(msg.type==="AI_BRIDGE_ACTION_STATUS"){
      try{
        const action=String(msg.action||"").toUpperCase();
        const authorityId=String(msg.authorityId||msg.dispatchId||"").trim();
        if(!action||!authorityId){
          sendResponse({ok:false,error:"INVALID_ACTION_STATUS_QUERY"});
          return false;
        }
        const cached=byAuthority.get(action+":"+authorityId)||null;
        sendResponse({
          ok:true,
          found:Boolean(cached),
          action,
          authorityId,
          result:cached?{...cached}:null,
          side:cached?.side||registration?.side||null,
          generationEpoch:cached?.generationEpoch??registration?.generationEpoch??null,
          conversationIdentity:cached?.conversationIdentity||routeIdentity()
        });
      }catch(error){
        sendResponse({ok:false,error:error.message||String(error)});
      }
      return false;
    }
    if(msg.type==="AI_BRIDGE_ACTION"){
      handleAction(msg).then(sendResponse).catch(error=>sendResponse({ok:false,outcome:"REJECTED_PRE_ACTION",reason:"CONTENT_GATE_ERROR",error:error.message||String(error)}));
      return true;
    }
    if(msg.type==="AI_BRIDGE_SEND"){
      sendResponse({ok:false,outcome:"REJECTED_PRE_ACTION",reason:"LEGACY_SEND_DISABLED",error:"Use AI_BRIDGE_ACTION with verified authority."});
      return false;
    }
    if(msg.type==="AI_BRIDGE_NEW_CHAT"){
      sendResponse({ok:false,outcome:"REJECTED_PRE_ACTION",reason:"NEW_CHAT_UNSUPPORTED",error:"Trusted New Chat authority is not available; no click was attempted."});
      return false;
    }
    if(msg.type==="AI_BRIDGE_READ_LATEST_EXCHANGE"){
      if(provider!=="chatgpt"){
        sendResponse({ok:false,error:"LATEST_EXCHANGE_RECOVERY_UNSUPPORTED_PROVIDER",provider,host});
        return false;
      }
      const exchange=latestExchangeObservation();
      const identity=routeIdentity();
      sendResponse({
        ok:Boolean(exchange.userText&&exchange.assistantText&&exchange.assistantAfterUser),
        provider,
        host,
        identity,
        active:generationActive(),
        userText:exchange.userText,
        assistantText:exchange.assistantText,
        assistantAfterUser:exchange.assistantAfterUser
      });
      return false;
    }
    if(msg.type==="AI_BRIDGE_READ_LAST_RESPONSE"){
      const text=responseText();
      const providerEvent=classifyProviderEvent(text);
      if(providerEvent){
        sendResponse({ok:false,error:"PROVIDER_EVENT_ACTIVE",providerEvent,active:generationActive(),host});
        return false;
      }
      sendResponse({ok:Boolean(text),text,active:generationActive(),host,provider,identity:routeIdentity()});
      return false;
    }
  };

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  function disposeContentRuntime(reason="disposed"){
    if(disposed) return;
    disposed=true;
    try{ observer.disconnect(); }catch(_){}
    if(routeTimer!==null){ clearInterval(routeTimer); routeTimer=null; }
    if(monitorTimer!==null){ clearTimeout(monitorTimer); monitorTimer=null; }
    if(responseDeliveryTimer!==null){ clearTimeout(responseDeliveryTimer); responseDeliveryTimer=null; }
    try{ chrome.runtime.onMessage.removeListener(onRuntimeMessage); }catch(_){}
    registration=null;
    awaitingDispatchId=null;
    awaitingResponseContext=null;
    awaitingResponseBaselineNode=null;
    awaitingResponseBaselineText="";
    lastObservedNode=null;
    pendingResponseDelivery=null;
    responseDeliveryInFlight=false;
    responseDeliveryAttempts=0;
    providerEventBaseline.clear();
    providerEventSignatures.clear();
    byCommand.clear();
    byAuthority.clear();
    const current=globalThis.__AI_BRIDGE_CONTENT_RUNTIME__;
    if(current && current.dispose===disposeContentRuntime){
      current.active=false;
      current.disposedReason=String(reason||"disposed").slice(0,80);
    }
  }

  globalThis.__AI_BRIDGE_CONTENT_RUNTIME__={
    schema:CONTENT_RUNTIME_SCHEMA,
    build:CONTENT_BUILD,
    active:true,
    installedAt:Date.now(),
    dispose:disposeContentRuntime
  };
  globalThis.__AI_BRIDGE_REVIEW_CONTENT__=true;
})();