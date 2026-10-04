import { Hono } from 'hono';
import { listAdEventMappings,saveAdEventMapping,adMappingPointExists } from '@line-crm/db';
import type { SaveAdEventMappingRequest } from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
export const adEventMappings=new Hono<Env>();
adEventMappings.get('/api/ad-platforms/mappings',requireRole('owner','admin','staff'),async c=>{
  const accountId=c.req.query('account_id');
  if(!accountId) return c.json({success:false,error:'LINEアカウントを選択してください'},422);
  if(!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[accountId])) return c.json({success:false,error:'対応表が見つかりません'},404);
  return c.json({success:true,data:await listAdEventMappings(c.env.DB,accountId)});
});
adEventMappings.put('/api/ad-platforms/mappings/:pointId',requireRole('owner','admin'),async c=>{
  const input=await c.req.json<SaveAdEventMappingRequest>().catch(()=>null);
  if(!input||typeof input.account_id!=='string'||!input.account_id||!['meta','google'].includes(input.provider)||!['auto','manual','off'].includes(input.mode)||!Number.isInteger(input.expectedVersion)||input.expectedVersion<0
    ||(input.mode==='manual'&&(typeof input.eventName!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.eventName)))
    ||(input.googleActionId!=null&&(input.provider!=='google'||typeof input.googleActionId!=='string'||!/^\d{1,30}$/.test(input.googleActionId)))) return c.json({success:false,error:'対応の名前・方法・現在の版を確認してください'},422);
  const pointId=c.req.param('pointId');
  if(!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[input.account_id])||!await adMappingPointExists(c.env.DB,pointId,input.account_id)) return c.json({success:false,error:'成果地点が見つかりません'},404);
  if(!await saveAdEventMapping(c.env.DB,pointId,input)) return c.json({success:false,error:'ほかの担当者が更新しました。読み直してください'},409);
  const mapping=(await listAdEventMappings(c.env.DB,input.account_id)).find(m=>m.pointId===pointId&&m.provider===input.provider);
  return c.json({success:true,data:mapping});
});
