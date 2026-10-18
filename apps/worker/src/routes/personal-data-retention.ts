import { Hono } from 'hono';
import { getAccountSetting, getVersionedAccountSetting, auditEventStatement } from '@line-crm/db';
import type { Env } from '../index.js';
import { inputJsonBoundary } from '../lib/input-errors.js';
import { denyReadOnly, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { parseRetentionPolicy, RETENTION_POLICY_KEY } from '../services/personal-data-retention.js';
import { sensitiveStepUpSatisfied, stepUpRequiredResponse } from '../lib/step-up.js';
export const personalDataRetention = new Hono<Env>();
const path='/api/account-settings/personal-data-retention';
personalDataRetention.get(path,requireRole('owner','admin'),async c=>{
  const accountId=c.req.query('accountId');
  if(!accountId)return c.json({success:false,error:'店を選んでください'},400);
  if(!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[accountId]))return c.json({success:false,error:'この店の設定は読めません'},403);
  const raw=await getAccountSetting(c.env.DB,accountId,RETENTION_POLICY_KEY);
  const versioned=await getVersionedAccountSetting(c.env.DB,accountId,RETENTION_POLICY_KEY);
  try { return c.json({success:true,data:{version:versioned?.version??0,policy:parseRetentionPolicy(raw)}}); }
  catch { return c.json({success:false,error:'保存期限の設定を確認できません',code:'RETENTION_POLICY_INVALID'},503); }
});
personalDataRetention.put(path,requireRole('owner','admin'),denyReadOnly(),inputJsonBoundary(),async c=>{
  const body=await c.req.json<{accountId?:unknown;expectedVersion?:unknown;policy?:unknown}>();
  if(typeof body.accountId!=='string'||!Number.isInteger(body.expectedVersion)||Number(body.expectedVersion)<0)return c.json({success:false,error:'店と読み込んだ版を指定してください'},422);
  if(!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[body.accountId]))return c.json({success:false,error:'この店の設定は変えられません'},403);
  let policy;try { if(!body.policy)throw new Error('missing');policy=parseRetentionPolicy(JSON.stringify(body.policy)); }
  catch {return c.json({success:false,error:'保存日数は1〜3650日の整数で、実行と保留はオンかオフで指定してください'},422);}
  if(!await sensitiveStepUpSatisfied(c,'privacy.retention'))return stepUpRequiredResponse(c,'保存期限を変える前に本人確認してください');
  const version=Number(body.expectedVersion), value=JSON.stringify({version:version+1,data:policy}), now=new Date().toISOString();
  const saved=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO account_settings(id,line_account_id,key,value,created_at,updated_at)
      SELECT ?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM account_settings WHERE line_account_id=? AND key=? AND json_valid(value) AND json_extract(value,'$.version')=?)
      ON CONFLICT(line_account_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
      WHERE json_valid(account_settings.value) AND json_extract(account_settings.value,'$.version')=?`)
      .bind(crypto.randomUUID(),body.accountId,RETENTION_POLICY_KEY,value,now,now,version,body.accountId,RETENTION_POLICY_KEY,version,version),
    auditEventStatement(c.env.DB,{category:'business',action:'privacy.retention.policy',tenantId:c.get('staff').tenantId,lineAccountId:body.accountId,actorPrincipalId:c.get('staff').id,targetKind:'retention',result:'success',after:policy,riskLevel:'high',retentionClass:'security'}, {sql:'changes()=1',params:[]}),
  ]);
  if(saved[0].meta.changes!==1)return c.json({success:false,error:'ほかの人が先に保存しました。読み直してください',code:'SAVE_CONFLICT'},409);
  return c.json({success:true,data:{version:version+1,policy}});
});
