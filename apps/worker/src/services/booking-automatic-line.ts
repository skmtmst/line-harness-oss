import { activeTenantLineAccountSql, isOperationCapabilityStopped, resolveLineCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import { dbFor } from './db-router.js';
import { featureJobCanRun } from './feature-enforcement.js';
import { pushViaHarnessProxy } from './line-proxy-send.js';
import { dispatchLineProxyLocally } from './local-line-proxy.js';
/** 自動通知は停止判定と履歴を持つHarness経由。manualヘッダは付けない。 */
export async function sendAutomaticBookingLine(env:Env['Bindings'],input:{accountId:string;to:string;text:string;retryKey:string;featureId:'booking'|'restaurant_test'}):Promise<boolean> {
 const db=dbFor(env,input.accountId);
 const account=await db.prepare(`SELECT channel_access_token,channel_access_token_encrypted FROM line_accounts la
 WHERE la.id=? AND ${activeTenantLineAccountSql('la.id')}`).bind(input.accountId).first<{channel_access_token:string|null;channel_access_token_encrypted:string|null}>();
 if(!account||await isOperationCapabilityStopped(db,input.accountId,'broadcast_dispatch')
 ||!await featureJobCanRun(db,{accountId:input.accountId,featureId:input.featureId,job:'予約の自動通知'}))return false;
 const token=await resolveLineCredential(account.channel_access_token_encrypted,account.channel_access_token,
 {lineAccountId:input.accountId,field:'channel_access_token'},env.LINE_CREDENTIAL_ENCRYPTION_KEY);
 if(!token)return false;
 await pushViaHarnessProxy(env.WORKER_PUBLIC_URL||env.WORKER_URL||'https://worker.invalid',token,input.to,
 [{type:'text',text:input.text}],input.retryKey,req=>dispatchLineProxyLocally(req,env));
 return true;
}
