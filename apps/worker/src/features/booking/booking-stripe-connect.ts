import { tracedFetch as fetch } from '@line-crm/shared/server';
import { getWorkflowStep } from '@line-crm/db';
import { runBookingExternalStep } from './booking-external-step.js';
import { API_RETRY_WAIT } from '../../lib/external-call/index.js';
import type { Env } from '../../worker-env.js';

export const STRIPE_CONNECT_CALLBACK = '/api/booking/admin/payment-connection/callback';
export class StripeConnectError extends Error {
  constructor(public code: string, public providerStatus?: number) { super(code); }
}

/** 予約専用のtest secretだけを使う。統括課金のSTRIPE_SECRET_KEYへフォールバックしない。 */
export function stripeConnectConfig(env: Env['Bindings']) {
  const key = env.BOOKING_STRIPE_TEST_SECRET_KEY;
  const clientId = env.BOOKING_STRIPE_TEST_CLIENT_ID;
  if (!key || !clientId || !env.BOOKING_STRIPE_CONNECT_REDIRECT_URI) throw new StripeConnectError('stripe_connect_not_ready');
  if (!/^sk_test_[A-Za-z0-9]+$/.test(key) || !/^ca_[A-Za-z0-9]+$/.test(clientId)) throw new StripeConnectError('stripe_connect_test_only');
  let redirect: URL;
  try { redirect = new URL(env.BOOKING_STRIPE_CONNECT_REDIRECT_URI); }
  catch { throw new StripeConnectError('stripe_connect_not_ready'); }
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash
    || redirect.pathname !== STRIPE_CONNECT_CALLBACK) throw new StripeConnectError('stripe_connect_not_ready');
  return { key, clientId, redirectUri: redirect.href };
}

export async function connectHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** URL・生の例外・Stripeのerror_descriptionを外へ出さない。再試行はしない。 */
async function stripeOAuth(config: ReturnType<typeof stripeConnectConfig>, operation: 'token' | 'deauthorize', values: Record<string, string>) {
  try {
    const response = await fetch(`https://connect.stripe.com/oauth/${operation}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${btoa(config.key + ':')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    });
    if (!response.ok) throw new StripeConnectError('stripe_connect_provider_failed',response.status);
    const data = await response.json() as Record<string, unknown>;
    if (data.error) throw new StripeConnectError('stripe_connect_provider_failed');
    return data;
  } catch(error) { if(error instanceof StripeConnectError)throw error;throw new StripeConnectError('stripe_connect_provider_failed'); }
}

interface OAuthExecution { db:D1Database; accountId:string; operationId:string; authorize:()=>Promise<boolean> }
async function recordedOAuth(config:ReturnType<typeof stripeConnectConfig>,operation:'token'|'deauthorize',values:Record<string,string>,execution?:OAuthExecution) {
  if(!execution)return stripeOAuth(config,operation,values);
  const bodyHash=await connectHash(new URLSearchParams(values).toString());
  const ref={scopeId:`line:${execution.accountId}`,processKind:'booking_stripe_oauth',subjectId:execution.operationId,stepKey:operation};
  const now=Date.now();
  const result=await runBookingExternalStep(execution.db,{
    ref,snapshot:{operation,bodyHash},
    identity:{scope:{accountId:execution.accountId,storeId:execution.accountId,destination:'stripe_oauth',connectionId:execution.accountId},
      operationId:execution.operationId,idempotencyKey:execution.operationId,snapshotId:bodyHash,effect:'write'},
    policy:{category:'api',maxAttempts:1,timeoutMs:10_000,deadlineAt:now+600000,wait:API_RETRY_WAIT},
    authorize:execution.authorize,
    execute:async()=>{
      try {
        const data=await stripeOAuth(config,operation,values);
        if(typeof data.stripe_user_id!=='string'||!/^acct_[A-Za-z0-9]{1,240}$/.test(data.stripe_user_id))return {kind:'unknown',reason:'invalid_response'};
        if(operation==='token'&&(data.livemode!==false||data.scope!=='read_write'))return {kind:'permanent',reason:'invalid_response'};
        // OAuthのaccess_token/refresh_tokenを台帳に保存しない。
        return {kind:'success',value:{stripe_user_id:data.stripe_user_id,livemode:data.livemode??false,scope:data.scope??null}};
      }catch(error){return {kind:error instanceof StripeConnectError&&error.providerStatus&&error.providerStatus>=400&&error.providerStatus<500?'permanent':'unknown',reason:'http'};}
    },
  });
  if(result.kind==='success')return result.value as Record<string,unknown>;
  if(result.kind==='succeeded') {
    const row=await getWorkflowStep(execution.db,ref);
    return (JSON.parse(row!.result_json!) as {value:Record<string,unknown>}).value;
  }
  throw new StripeConnectError(result.kind==='unknown'?'stripe_connect_result_unknown':'stripe_connect_provider_failed');
}

export async function exchangeStripeConnectCode(config: ReturnType<typeof stripeConnectConfig>, code: string, execution?:OAuthExecution) {
  const data = await recordedOAuth(config, 'token', { grant_type: 'authorization_code', code },execution);
  if (data.livemode !== false) throw new StripeConnectError('stripe_connect_test_only');
  if (data.scope !== 'read_write' || typeof data.stripe_user_id !== 'string' || !/^acct_[A-Za-z0-9]{1,240}$/.test(data.stripe_user_id)) {
    throw new StripeConnectError('stripe_connect_invalid_response');
  }
  // access_token/refresh_tokenは使わない・保存しない。
  return data.stripe_user_id;
}

export async function revokeStripeConnect(config: ReturnType<typeof stripeConnectConfig>, account: string, execution?:OAuthExecution) {
  const data = await recordedOAuth(config, 'deauthorize', { client_id: config.clientId, stripe_user_id: account },execution);
  if (data.stripe_user_id !== account) throw new StripeConnectError('stripe_connect_invalid_response');
}
