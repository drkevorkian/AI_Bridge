(() => {
  if (globalThis.__AI_BRIDGE_REVIEW_CONTENT__) return;
  globalThis.__AI_BRIDGE_REVIEW_CONTENT__ = true;

  const VERSION = "1.18.0-review.4";
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
      send: Object.freeze(["button[data-testid='send-button']","button[aria-label='Send prompt']"]),
      response: Object.freeze(["[data-message-author-role='assistant'] .markdown","[data-message-author-role='assistant']"])
    }),
    grok: Object.freeze({
      composer: Object.freeze(["textarea[placeholder*='Ask']","div[contenteditable='true'][aria-label*='Grok']"]),
      send: Object.freeze(["button[aria-label='Send message']"]),
      response: Object.freeze(["[data-testid='message-text']"])
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
  let lastResponseSignature = "";
  let lastObserved = "";
  let lastChangedAt = 0;
  let monitorTimer = null;
  let lastLimitSignature = "";
  let lastProviderEventSignature = "";

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
      send: resolveTrusted(config.send,{requireEnabled:true}) ? "PASS" : "FAIL",
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
      node.replaceChildren();
      const lines=String(text).split("\n");
      lines.forEach((line,index)=>{if(index)node.appendChild(document.createElement("br"));node.appendChild(document.createTextNode(line));});
      node.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
      return;
    }
    throw new Error("TRUSTED_COMPOSER_NOT_EDITABLE");
  }
  async function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
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

    const composer1=resolveTrusted(config.composer);
    const send1=resolveTrusted(config.send,{requireEnabled:true});
    if(!composer1 || !send1) return rememberCommand(command,reject(command,"DOM_AUTHORITY_UNAVAILABLE"));
    const composer2=resolveTrusted(config.composer);
    const send2=resolveTrusted(config.send,{requireEnabled:true});
    if(composer1!==composer2 || send1!==send2 || !composer2?.isConnected || !send2?.isConnected) {
      return rememberCommand(command,reject(command,"DOM_AUTHORITY_CHANGED"));
    }

    const text=String(command.payload?.text||"");
    if(!text.trim()) return rememberCommand(command,reject(command,"EMPTY_PROMPT"));
    setComposerText(composer2,text);
    await sleep(120);
    const send3=resolveTrusted(config.send,{requireEnabled:true});
    if(send3!==send2) return rememberCommand(command,reject(command,"DOM_AUTHORITY_CHANGED"));

    const attempted=Object.freeze({ok:false,outcome:"ACTION_ATTEMPTED",reason:"ACTION_CONFIRMATION_NOT_PROVEN",commandId:command.commandId,authorityId:command.authorityId});
    consumeAuthority(command,attempted);
    captureProviderEventBaseline();
    send3.click();
    awaitingDispatchId=command.authorityId;
    const confirmation=await confirmSend(composer2,text);
    if(!confirmation.confirmed) return attempted;
    return consumeAuthority(command,Object.freeze({ok:true,outcome:"ACTION_CONFIRMED",reason:null,commandId:command.commandId,authorityId:command.authorityId,evidence:confirmation.evidence}));
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

  function responseText(){
    const nodes=[];
    for(const selector of config.response||[]){
      try{ for(const node of document.querySelectorAll(selector)) if(visible(node)&&!nodes.includes(node)) nodes.push(node); }catch(_){}
    }
    const node=nodes[nodes.length-1]; if(!node) return "";
    return String(node.innerText||node.textContent||"").replace(/\u00a0/g," ").trim();
  }
  function generationActive(){
    const stopSelectors=provider==="chatgpt"?["button[data-testid='stop-button']","button[aria-label='Stop generating']"]
      :provider==="grok"?["button[aria-label='Stop']"]
      :provider==="gemini"?["button[aria-label*='Stop']"]:[];
    return Boolean(resolveTrusted(stopSelectors,{requireEnabled:true}));
  }
  async function monitor(){
    monitorTimer=null;
    if(!awaitingDispatchId) return;
    if(await inspectProviderEvent()){scheduleMonitor(750);return;}
    const text=responseText();
    if(!text) return;
    if(text!==lastObserved){lastObserved=text;lastChangedAt=Date.now();scheduleMonitor(350);return;}
    if(generationActive() || Date.now()-lastChangedAt<1600){scheduleMonitor(350);return;}
    const signature=awaitingDispatchId+"::"+text;
    if(signature===lastResponseSignature) return;
    lastResponseSignature=signature;
    const dispatchId=awaitingDispatchId;
    awaitingDispatchId=null;
    try{
      if(!registration) return;
      await chrome.runtime.sendMessage({
        type:"AI_BRIDGE_RESPONSE",
        text,
        completedAt:Date.now(),
        dispatchId,
        generationEpoch:registration.generationEpoch,
        conversationIdentity:registration.identity,
        side:registration.side,
        artifacts:[]
      });
    }catch(_){}
  }
  function scheduleMonitor(ms=250){ if(monitorTimer) return; monitorTimer=setTimeout(()=>monitor().catch(()=>{}),ms); }

  function normalizeNoticeText(value){
    return String(value||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
  }
  function classifyProviderEvent(rawText){
    const text=normalizeNoticeText(rawText);
    if(!text) return null;
    const rules=[
      ["MESSAGE_DELIVERY_TIMEOUT",/\bmessage delivery timed out\b.*\bplease try again\b/i,"ERROR",true],
      ["MESSAGE_SEND_FAILED",/\b(?:message|prompt)\s+(?:failed to send|could not be sent)\b/i,"ERROR",true],
      ["RESPONSE_GENERATION_ERROR",/\b(?:there was|we encountered)\s+(?:an?\s+)?error\s+(?:generating|while generating)\s+(?:a\s+)?response\b/i,"ERROR",true],
      ["NETWORK_ERROR",/\bnetwork error\b|\bconnection (?:lost|interrupted)\b/i,"ERROR",true],
      ["RATE_LIMIT",/\btoo many requests\b|\brate limit\b|\busage limit\b/i,"WARN",false],
      ["SERVICE_ERROR",/\bsomething went wrong\b|\bservice unavailable\b/i,"ERROR",false]
    ];
    for(const [code,re,severity,deliveryAmbiguous] of rules){
      if(re.test(text)) return Object.freeze({code,severity,deliveryAmbiguous,text:text.slice(0,500)});
    }
    return null;
  }
  function providerEventCandidateElements(mutations=[]){
    const out=new Set();
    const add=node=>{
      const el=node?.nodeType===Node.TEXT_NODE?node.parentElement:node;
      if(!(el instanceof Element) || !el.isConnected) return;
      const semantic=el.matches("[role='alert'],[aria-live='assertive'],[aria-live='polite']");
      if(el.closest("[data-message-author-role]")) return;
      if(!semantic && el.querySelector?.("[data-message-author-role]")) return;
      out.add(el);
      if(out.size>=40) return;
      for(const child of el.querySelectorAll?.("[role='alert'],[aria-live='assertive'],[aria-live='polite']")||[]){
        if(!child.closest("[data-message-author-role]")) out.add(child);
        if(out.size>=40) break;
      }
    };
    for(const mutation of mutations||[]){
      add(mutation.target);
      for(const node of mutation.addedNodes||[]) add(node);
      if(out.size>=40) break;
    }
    if(!out.size){
      for(const node of document.querySelectorAll("[role='alert'],[aria-live='assertive'],[aria-live='polite']")){
        if(!node.closest("[data-message-author-role]")) out.add(node);
        if(out.size>=40) break;
      }
    }
    return [...out];
  }
  function inspectProviderEvents(mutations=[]){
    for(const node of providerEventCandidateElements(mutations)){
      if(!visible(node)) continue;
      const event=classifyProviderEvent(node.innerText||node.textContent||"");
      if(!event) continue;
      const dispatchId=String(awaitingDispatchId||"");
      const signature=[event.code,dispatchId,event.text].join("::");
      if(signature===lastProviderEventSignature) return;
      lastProviderEventSignature=signature;
      chrome.runtime.sendMessage({
        type:"AI_BRIDGE_PROVIDER_EVENT",
        provider,
        code:event.code,
        severity:event.severity,
        deliveryAmbiguous:event.deliveryAmbiguous,
        text:event.text,
        dispatchId,
        observedAt:Date.now(),
        generationEpoch:registration?.generationEpoch??null,
        conversationIdentity:registration?.identity??routeIdentity()
      }).catch(()=>{});
      return;
    }
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
      if(signature===lastLimitSignature) return;
      lastLimitSignature=signature;
      chrome.runtime.sendMessage({type:"AI_BRIDGE_THREAD_LIMIT",provider,text:signature}).catch(()=>{});
      return;
    }
  }

  const observer=new MutationObserver(mutations=>{scheduleMonitor();inspectThreadLimit();inspectProviderEvents(mutations);});
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["disabled","aria-disabled","data-state","aria-label","data-testid"]});

  setInterval(()=>{
    if(location.href!==lastHref){
      lastHref=location.href;
      registration=null;
      awaitingDispatchId=null;
      providerEventBaseline=new Set();
      providerEventSignatures.clear();
      byCommand.clear();
      byAuthority.clear();
      chrome.runtime.sendMessage({type:"AI_BRIDGE_DOCUMENT_ROUTE_CHANGED"}).catch(()=>{});
    }
    scheduleMonitor();
    inspectThreadLimit();
    inspectProviderEvents();
  },750);

  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
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
    if(msg.type==="AI_BRIDGE_READ_LAST_RESPONSE"){
      const text=responseText();
      const providerEvent=classifyProviderEvent(text);
      if(providerEvent){
        sendResponse({ok:false,error:"PROVIDER_EVENT_ACTIVE",providerEvent,active:generationActive(),host});
        return false;
      }
      sendResponse({ok:Boolean(text),text,active:generationActive(),host});
      return false;
    }
  });
})();