import type { LineClient,Message } from '@line-crm/line-sdk';
import { claimWorkflowStep,ensureWorkflowStep,failWorkflowStep,finishWorkflowStep,getWorkflowStep } from '@line-crm/db';
import type { WorkflowExecution } from './workflow-execution.js';
import { WorkflowDeferred } from './workflow-execution.js';

/** Automatic event sends share fixed wire inputs and UUIDs; reply tokens are never persisted. */
export function workflowLineClient(client:LineClient,execution:WorkflowExecution):LineClient {
  const ordinals=new Map<string,number>();
  return new Proxy(client,{get(target,key){
    if(!['pushMessage','pushMessageWithRequestId','replyMessage','replyMessageWithRequestId'].includes(String(key))) {
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }
    return async(toOrToken:string,messages:Message[],_retryKey?:string)=>{
      const method=String(key),namespace=`${execution.activeStep ?? 'direct'}:${method}`,index=ordinals.get(namespace) ?? 0;ordinals.set(namespace,index+1);
      const reply=method.startsWith('reply');
      const ref={...execution.ref,stepKey:`line:${namespace}:${index}`};
      const previous=await ensureWorkflowStep(execution.db,ref,{input:reply?{messages}:{to:toOrToken,messages},maxAttempts:5,retryKey:reply?undefined:_retryKey});
      if(previous.status==='succeeded') return JSON.parse(previous.result_json ?? 'null');
      if(reply && previous.first_attempt_at!==null) throw new WorkflowDeferred('reply_unknown');
      const row=await claimWorkflowStep(execution.db,ref);
      if(!row) throw new WorkflowDeferred((await getWorkflowStep(execution.db,ref))?.status ?? 'busy');
      const original=JSON.parse(row.input_json!);
      try {
        if(!reply && row.attempt_count>1 && Date.now()-row.first_attempt_at!>=23*3600_000) {
          await failWorkflowStep(execution.db,ref,row.lease_owner!,{unknown:true,code:'delivery_unknown'});
          throw new WorkflowDeferred('delivery_unknown');
        }
        const result=reply
          ? await (target[method as 'replyMessage'] as Function).call(target,toOrToken,original.messages)
          : await (target[method as 'pushMessage'] as Function).call(target,original.to,original.messages,row.retry_key);
        await finishWorkflowStep(execution.db,ref,row.lease_owner!,{result});
        return result;
      }catch(error){
        await failWorkflowStep(execution.db,ref,row.lease_owner!,{unknown:reply,code:reply?'reply_unknown':'delivery_failed',delayMs:0});
        throw error;
      }
    };
  }});
}
