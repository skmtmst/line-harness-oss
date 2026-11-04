import { Hono, type Context } from 'hono';
import { BOOKING_MENUS_KEY, type HqCatalogTemplateType } from '@line-crm/shared';
import { inputError, inputJsonBoundary } from '../lib/input-errors.js';
import { denyReadOnly, requirePermission, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { decideCatalogUpdate, pendingCatalogDecision } from '../services/hq-templates/catalog-store-decisions.js';
import { HqTemplateError } from '../services/hq-templates/tag.js';
import type { Env } from '../worker-env.js';

export const hqCatalogStore = new Hono<Env>();
hqCatalogStore.onError((error,c)=>{
  if(error instanceof HqTemplateError)return c.json({success:false,code:error.code,error:error.status===403?'この操作を実行する権限がありません':'内容が変わりました。読み直してください'},error.status);
  throw error;
});

async function account(c:Context<Env>):Promise<string|null>{
  const id=c.req.query('accountId')?.trim();
  return id&&await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[id])?id:null;
}
async function read(c:Context<Env>,type:HqCatalogTemplateType){
  const id=await account(c),targetId=c.req.param('id');if(!id||!targetId)return c.json({success:false,error:'対象が見つかりません'},404);
  return c.json({success:true,data:await pendingCatalogDecision(c.env.DB,id,type,targetId)});
}
async function decide(c:Context<Env>,type:HqCatalogTemplateType){
  const id=await account(c),targetId=c.req.param('id');if(!id||!targetId)return c.json({success:false,error:'対象が見つかりません'},404);
  const staff=c.get('staff'),impersonation=c.get('impersonation');
  if(!staff||staff.readOnly||(impersonation&&impersonation.mode!=='write'))return c.json({success:false,error:'この操作を実行する権限がありません'},403);
  const body=await c.req.json<{decisionId?:unknown;action?:unknown;snapshot?:unknown}>();
  if(typeof body.decisionId!=='string'||!body.decisionId||(body.action!=='adopt'&&body.action!=='keep')||typeof body.snapshot!=='string'||!/^[a-f0-9]{64}$/.test(body.snapshot))return inputError(c,{success:false,error:'確認した内容を読み直してください'},400,['decisionId','action','snapshot']);
  const data=await decideCatalogUpdate(c.env.DB,{accountId:id,type,targetId,decisionId:body.decisionId,action:body.action,snapshot:body.snapshot,actorId:staff.id,actorRole:staff.role,allowPublished:!impersonation});
  return c.json({success:true,data});
}

hqCatalogStore.get('/api/booking/admin/menus/:id/hq-update',requirePermission(BOOKING_MENUS_KEY),c=>read(c,'booking_menu'));
hqCatalogStore.post('/api/booking/admin/menus/:id/hq-update',requirePermission(BOOKING_MENUS_KEY),denyReadOnly(),inputJsonBoundary(),c=>decide(c,'booking_menu'));
hqCatalogStore.get('/api/mileage/rewards/:id/hq-update',requireRole('owner','admin','staff'),c=>read(c,'mileage_reward'));
hqCatalogStore.post('/api/mileage/rewards/:id/hq-update',requireRole('owner','admin'),denyReadOnly(),inputJsonBoundary(),c=>decide(c,'mileage_reward'));
