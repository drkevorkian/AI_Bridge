import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.join(here,"../runtime_review/content.js"),"utf8");

function harness(initialBuild,{legacy=false}={}){
  let build=initialBuild;
  const messages=[];
  const listeners=new Set();
  const stats={
    listenerAdds:0,
    listenerRemoves:0,
    observerCreates:0,
    observerDisconnects:0,
    intervalCreates:0,
    intervalClears:0
  };
  let nextTimer=1;

  class FakeMutationObserver{
    constructor(){stats.observerCreates+=1;}
    observe(){}
    disconnect(){stats.observerDisconnects+=1;}
  }
  class FakeElement{}
  class FakeTextArea extends FakeElement{}
  class FakeInput extends FakeElement{}

  const context={
    console,
    location:{hostname:"chatgpt.com",pathname:"/",href:"https://chatgpt.com/"},
    document:{
      documentElement:{},
      querySelectorAll(){return[];},
      createElement(){return new FakeElement();},
      createTextNode(text){return{textContent:String(text)};}
    },
    getComputedStyle(){return{visibility:"visible",display:"block"};},
    MutationObserver:FakeMutationObserver,
    HTMLTextAreaElement:FakeTextArea,
    HTMLInputElement:FakeInput,
    InputEvent:class{},
    Event:class{},
    setInterval(){stats.intervalCreates+=1;return nextTimer++;},
    clearInterval(){stats.intervalClears+=1;},
    setTimeout(){return nextTimer++;},
    clearTimeout(){},
    chrome:{
      runtime:{
        getManifest(){return{version:"1.19.1",version_name:build};},
        sendMessage(message){messages.push(message);return Promise.resolve({ok:true});},
        onMessage:{
          addListener(fn){stats.listenerAdds+=1;listeners.add(fn);},
          removeListener(fn){stats.listenerRemoves+=1;listeners.delete(fn);}
        }
      }
    }
  };
  if(legacy) context.__AI_BRIDGE_REVIEW_CONTENT__=true;
  vm.createContext(context);
  return{
    context,messages,stats,
    setBuild(value){build=value;},
    run(){vm.runInContext(source,context,{filename:"content.js"});}
  };
}

{
  const h=harness("1.19.1.05-AI-A");
  h.run();
  const first=h.context.__AI_BRIDGE_CONTENT_RUNTIME__;
  assert.equal(first.schema,1);
  assert.equal(first.build,"1.19.1.05-AI-A");
  assert.equal(first.active,true);
  assert.equal(h.stats.listenerAdds,1);
  assert.equal(h.stats.observerCreates,1);
  assert.equal(h.stats.intervalCreates,1);

  h.run();
  const second=h.context.__AI_BRIDGE_CONTENT_RUNTIME__;
  assert.notEqual(second,first,"explicit same-build reinjection must replace a possibly invalidated resident runtime");
  assert.equal(first.active,false,"same-build resident runtime was not disposed");
  assert.equal(first.disposedReason,"same-build-reinjection");
  assert.equal(second.build,"1.19.1.05-AI-A");
  assert.equal(second.active,true);
  assert.equal(h.stats.listenerRemoves,1);
  assert.equal(h.stats.observerDisconnects,1);
  assert.equal(h.stats.intervalClears,1);
  assert.equal(h.stats.listenerAdds,2);
  assert.equal(h.stats.observerCreates,2);
  assert.equal(h.stats.intervalCreates,2);

  h.setBuild("1.19.2.01-AI-A");
  h.run();
  const third=h.context.__AI_BRIDGE_CONTENT_RUNTIME__;
  assert.notEqual(third,second);
  assert.equal(second.active,false,"older runtime was not disposed");
  assert.equal(second.disposedReason,"superseded");
  assert.equal(third.build,"1.19.2.01-AI-A");
  assert.equal(third.active,true);
  assert.equal(h.stats.listenerRemoves,2);
  assert.equal(h.stats.observerDisconnects,2);
  assert.equal(h.stats.intervalClears,2);
  assert.equal(h.stats.listenerAdds,3);
  assert.equal(h.stats.observerCreates,3);
  assert.equal(h.stats.intervalCreates,3);
}

{
  const h=harness("1.19.2.01-AI-A",{legacy:true});
  h.run();
  assert.equal(h.context.__AI_BRIDGE_CONTENT_RUNTIME__,undefined);
  assert.equal(h.stats.listenerAdds,0);
  assert.equal(h.stats.observerCreates,0);
  assert.equal(h.stats.intervalCreates,0);
  assert.equal(
    h.messages.some(m=>m?.type==="AI_BRIDGE_CONTENT_RUNTIME_INCOMPATIBLE"&&m?.reason==="LEGACY_RUNTIME_NOT_DISPOSABLE"),
    true,
    "legacy runtime must fail closed and report incompatibility"
  );
}

{
  const h=harness("1.19.2.01-AI-A");
  h.context.__AI_BRIDGE_CONTENT_RUNTIME__={schema:999,build:"alien",active:true};
  h.run();
  assert.equal(h.context.__AI_BRIDGE_CONTENT_RUNTIME__.build,"alien");
  assert.equal(h.stats.listenerAdds,0);
  assert.equal(
    h.messages.some(m=>m?.type==="AI_BRIDGE_CONTENT_RUNTIME_INCOMPATIBLE"),
    true,
    "unknown runtime schema must fail closed"
  );
}

console.log("round42-content-runtime-lifecycle: PASS");
