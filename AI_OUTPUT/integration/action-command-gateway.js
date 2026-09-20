export const ACTION_OUTCOME=Object.freeze({REJECTED_PRE_ACTION:'REJECTED_PRE_ACTION',ACTION_ATTEMPTED:'ACTION_ATTEMPTED',ACTION_CONFIRMED:'ACTION_CONFIRMED'});
export const ACTION_REASON=Object.freeze({INVALID_COMMAND:'INVALID_COMMAND',STALE_DOCUMENT_AUTHORITY:'STALE_DOCUMENT_AUTHORITY',STALE_GENERATION:'STALE_GENERATION',STALE_CONVERSATION_AUTHORITY:'STALE_CONVERSATION_AUTHORITY',DUPLICATE_COMMAND:'DUPLICATE_COMMAND',DOM_AUTHORITY_UNAVAILABLE:'DOM_AUTHORITY_UNAVAILABLE',DOM_AUTHORITY_CHANGED:'DOM_AUTHORITY_CHANGED',ACTION_FAILED_AFTER_ATTEMPT:'ACTION_FAILED_AFTER_ATTEMPT'});
const ACTIONS=new Set(['SEND','NEW_CHAT','UPLOAD','STOP']);
function requiredText(v,name,max=200){const s=String(v??'').trim();if(!s)throw new TypeError(name+' required.');return s.slice(0,max);}
function sameIdentity(a,b){return Boolean(a&&b)&&['provider','threadKey','routeClass'].every(k=>String(a[k]??'')===String(b[k]??''));}
function reject(command,reason,detail=null){return Object.freeze({ok:false,outcome:ACTION_OUTCOME.REJECTED_PRE_ACTION,reason,commandId:String(command?.commandId||''),authorityId:String(command?.authorityId||''),detail:detail==null?null:String(detail).slice(0,160)});}
export class ActionCommandGateway{
  constructor({documentAuthority,deriveIdentity,resolveAuthority,performAction,maxSeen=128}={}){
    if(!documentAuthority||typeof documentAuthority!=='object')throw new TypeError('documentAuthority required.');
    if(typeof deriveIdentity!=='function'||typeof resolveAuthority!=='function'||typeof performAction!=='function')throw new TypeError('gateway dependencies required.');
    this.documentAuthority=documentAuthority;this.deriveIdentity=deriveIdentity;this.resolveAuthority=resolveAuthority;this.performAction=performAction;this.maxSeen=Math.max(16,Math.min(1024,Number(maxSeen)||128));this.byCommand=new Map();this.byAuthority=new Map();
  }
  _remember(command,result){this.byCommand.set(command.commandId,result);this.byAuthority.set(command.action+':'+command.authorityId,result);while(this.byCommand.size>this.maxSeen)this.byCommand.delete(this.byCommand.keys().next().value);while(this.byAuthority.size>this.maxSeen)this.byAuthority.delete(this.byAuthority.keys().next().value);return result;}
  _duplicate(command){return this.byCommand.get(command.commandId)||this.byAuthority.get(command.action+':'+command.authorityId)||null;}
  async handle(raw){
    let command;
    try{
      const action=requiredText(raw?.action,'action').toUpperCase();
      const authorityId=raw?.dispatchId??raw?.rolloverId??raw?.authorityId;
      command={...raw,action,commandId:requiredText(raw?.commandId,'commandId'),authorityId:requiredText(authorityId,'authorityId'),documentId:requiredText(raw?.documentId,'documentId'),side:requiredText(raw?.side,'side',16).toUpperCase(),generationEpoch:Number(raw?.generationEpoch)};
    }catch(e){return reject(raw,ACTION_REASON.INVALID_COMMAND,e.message);}
    if(!ACTIONS.has(command.action)||!Number.isInteger(command.generationEpoch)||command.generationEpoch<0)return reject(command,ACTION_REASON.INVALID_COMMAND);
    const duplicate=this._duplicate(command);if(duplicate)return Object.freeze({...duplicate,duplicate:true,reason:ACTION_REASON.DUPLICATE_COMMAND});
    const doc=this.documentAuthority;
    if(command.documentId!==String(doc.documentId||'')||command.side!==String(doc.side||'').toUpperCase())return this._remember(command,reject(command,ACTION_REASON.STALE_DOCUMENT_AUTHORITY));
    if(command.generationEpoch!==Number(doc.generationEpoch))return this._remember(command,reject(command,ACTION_REASON.STALE_GENERATION));
    const identity=await this.deriveIdentity();
    if(!sameIdentity(identity,command.expectedIdentity))return this._remember(command,reject(command,ACTION_REASON.STALE_CONVERSATION_AUTHORITY));
    const first=await this.resolveAuthority(command.action,command);
    if(!first?.ok||!first.node)return this._remember(command,reject(command,ACTION_REASON.DOM_AUTHORITY_UNAVAILABLE,first?.reason));
    const second=await this.resolveAuthority(command.action,command);
    if(!second?.ok||second.node!==first.node||second.node?.isConnected===false)return this._remember(command,reject(command,ACTION_REASON.DOM_AUTHORITY_CHANGED,second?.reason));
    const attempted=Object.freeze({ok:false,outcome:ACTION_OUTCOME.ACTION_ATTEMPTED,reason:ACTION_REASON.ACTION_FAILED_AFTER_ATTEMPT,commandId:command.commandId,authorityId:command.authorityId});
    this._remember(command,attempted);
    try{
      const detail=await this.performAction(command.action,second.node,command.payload,command);
      return this._remember(command,Object.freeze({ok:true,outcome:ACTION_OUTCOME.ACTION_CONFIRMED,reason:null,commandId:command.commandId,authorityId:command.authorityId,detail:detail??null}));
    }catch(e){return this._remember(command,Object.freeze({...attempted,detail:String(e?.message||e).slice(0,160)}));}
  }
}
