import type { Env } from '../worker-env.js';
import {GapError} from './gap-common.js';
export type AccountAiFeature='banner'|'google_review';
export const AI_DISCLOSURE_VERSION='2026-10-16';
export const AI_DISCLOSURE='会話や入力した文章・画像がAIの提供会社に送られることに同意します';
/** Operators control this deployment variable. An absent/unknown environment stays closed. */
export function g2OpenAiAvailable(env:Pick<Env['Bindings'],'DEPLOY_ENV'|'G2_OPENAI_ENABLED'>){
 return env.G2_OPENAI_ENABLED==='true'&&['local','test','development','staging'].includes(env.DEPLOY_ENV??'');
}
export async function accountAiSetting(db:D1Database,account:string,feature:AccountAiFeature){
 const row=await db.prepare('SELECT enabled,version,consent_by,consent_at,disclosure_version FROM account_ai_features WHERE account_id=? AND feature=?').bind(account,feature).first<{enabled:number;version:number;consent_by:string|null;consent_at:string|null;disclosure_version:string|null}>();
 return {feature,enabled:row?.enabled===1,version:row?.version??0,consentBy:row?.consent_by??null,consentAt:row?.consent_at??null,disclosureVersion:row?.disclosure_version??null};
}
/** Also checked by the durable banner worker, so queued work cannot bypass a later opt-out. */
export async function requireAccountAi(db:D1Database,account:string|null|undefined,feature:AccountAiFeature,tenant?:string){
 if(!account)throw new GapError('ai_disabled',409);
 const active=await db.prepare(`SELECT 1 FROM line_accounts a JOIN tenants t ON t.id=a.tenant_id WHERE a.id=? AND a.is_active=1 AND t.status='active' AND (? IS NULL OR a.tenant_id=?)`).bind(account,tenant??null,tenant??null).first();
 if(!active||!(await accountAiSetting(db,account,feature)).enabled)throw new GapError('ai_disabled',409);
}
