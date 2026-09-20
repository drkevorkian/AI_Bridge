import {ACTION_OUTCOME} from './action-command-gateway.js';
export const DISPATCH_RESULT=Object.freeze({CONFIRMED:'CONFIRMED',PRE_ACTION_REJECTED:'PRE_ACTION_REJECTED',DELIVERY_AMBIGUOUS:'DELIVERY_AMBIGUOUS'});
export class ActionDispatchController{
  constructor({sendMessage}={}){if(typeof sendMessage!=='function')throw new TypeError('sendMessage required.');this.sendMessage=sendMessage;}
  async issue({tabId,documentId,command}){
    try{
      const reply=await this.sendMessage(tabId,command,{documentId});
      if(reply?.outcome===ACTION_OUTCOME.REJECTED_PRE_ACTION)return Object.freeze({state:DISPATCH_RESULT.PRE_ACTION_REJECTED,reply});
      if(reply?.outcome===ACTION_OUTCOME.ACTION_CONFIRMED)return Object.freeze({state:DISPATCH_RESULT.CONFIRMED,reply});
      return Object.freeze({state:DISPATCH_RESULT.DELIVERY_AMBIGUOUS,reply:reply||null,reason:'ACTION_OUTCOME_NOT_PROVEN'});
    }catch(error){return Object.freeze({state:DISPATCH_RESULT.DELIVERY_AMBIGUOUS,reply:null,reason:'MESSAGE_ACK_UNAVAILABLE',detail:String(error?.message||error).slice(0,160)});}
  }
}
