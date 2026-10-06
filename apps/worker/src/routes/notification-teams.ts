import { Hono } from 'hono';
import { listOperatorNotificationTeams,getOperatorNotificationTeam,saveOperatorNotificationTeam,archiveOperatorNotificationTeam } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
export const notificationTeams=new Hono<Env>();
notificationTeams.get('/api/notifications/teams',requireRole('owner','admin'),async c=>{
  const accountId=c.req.query('lineAccountId');
  if(!accountId) return c.json({success:false,error:'LINEアカウントを選択してください'},400);
  if(!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[accountId])) return c.json({success:false,error:'権限がありません'},403);
  return c.json({success:true,data:await listOperatorNotificationTeams(c.env.DB,accountId)});
});
for(const method of ['post','put','delete'] as const) {
  notificationTeams[method](method==='post'?'/api/notifications/teams':'/api/notifications/teams/:id',requireRole('owner','admin'),async c=>{
    const body=await c.req.json<{lineAccountId?:string;name?:string;staffIds?:unknown;expectedVersion?:number}>().catch(()=>null);
    if(!body?.lineAccountId) return c.json({success:false,error:'LINEアカウントを選択してください'},422);
    if(!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[body.lineAccountId])) return c.json({success:false,error:'権限がありません'},403);
    const id=c.req.param('id');
    if(method!=='post') {
      if(!Number.isInteger(body.expectedVersion)||!body.expectedVersion||body.expectedVersion<1) return c.json({success:false,error:'現在の版を指定してください'},422);
      if(!await getOperatorNotificationTeam(c.env.DB,id!,body.lineAccountId)) return c.json({success:false,error:'チームが見つかりません'},404);
    }
    if(method==='delete') {
      const saved=await archiveOperatorNotificationTeam(c.env.DB,id!,body.lineAccountId,body.expectedVersion!);
      return saved ? c.json({success:true,data:null}) : c.json({success:false,error:'ほかの担当者が更新しました。読み直してください'},409);
    }
    if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100||!Array.isArray(body.staffIds)||body.staffIds.length===0||body.staffIds.length>200||!body.staffIds.every(v=>typeof v==='string'&&v.length>0)) return c.json({success:false,error:'チーム名と1人以上のスタッフを指定してください'},422);
    try {
      const saved=await saveOperatorNotificationTeam(c.env.DB,{id:method==='put'?id:undefined,lineAccountId:body.lineAccountId,name:body.name.trim(),staffIds:body.staffIds,expectedVersion:body.expectedVersion});
      return saved ? c.json({success:true,data:saved},method==='post'?201:200) : c.json({success:false,error:'ほかの担当者が更新しました。読み直してください'},409);
    } catch(error) {
      if(error instanceof Error&&error.message==='invalid_team_members') return c.json({success:false,error:'このアカウントを担当する有効なスタッフを選んでください'},422);
      throw error;
    }
  });
}
