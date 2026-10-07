import { Hono, type Context } from 'hono';
import { createLineAccountTag, deleteLineAccountTag, getLineAccountTag, getLineAccountById,
  listLineAccountFolders, updateLineAccountTag, replaceLineAccountTags, serializeLineAccountTag } from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { requireRole, denyReadOnly } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope, canAccessAllLineAccounts } from '../services/account-access.js';
import { auditLog } from '../lib/audit-log.js';
import { readAccountClassificationInput } from './line-account-tags.js';

export const lineAccountFolders = new Hono<Env>();
const tenantOf = (c: Context<Env>) => c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
const folder = (row: Parameters<typeof serializeLineAccountTag>[0]) => ({...serializeLineAccountTag(row),kind:'line_account',parentId:null});
lineAccountFolders.onError((error,c) => c.json({success:false,error:error.message.includes('UNIQUE constraint') ? '同じ名前のフォルダがあります' : 'フォルダを保存・取得できませんでした'},error.message.includes('UNIQUE constraint') ? 409 : 500));
lineAccountFolders.get('/api/line-account-folders', async c => {
  const scope = await getVisibleLineAccountScope(c.env.DB,c.get('staff'));
  return c.json({success:true,data:await listLineAccountFolders(c.env.DB,tenantOf(c),scope.allowedAccountIds)});
});
lineAccountFolders.post('/api/line-account-folders', requireRole('owner','admin'),denyReadOnly(),async c => {
  const input=readAccountClassificationInput(await c.req.json().catch(()=>null),true);
  if(!input?.name) return c.json({success:false,error:'フォルダの名前・色・並び順を確認してください'},400);
  const row=await createLineAccountTag(c.env.DB,tenantOf(c),{...input,name:input.name});
  auditLog(c,'line_account_folder.create',{kind:'line_account_folder',id:row.id});
  return c.json({success:true,data:folder(row)},201);
});
lineAccountFolders.patch('/api/line-account-folders/:id',requireRole('owner','admin'),denyReadOnly(),async c => {
  const input=readAccountClassificationInput(await c.req.json().catch(()=>null),false);
  if(!input) return c.json({success:false,error:'フォルダの名前・色・並び順を確認してください'},400);
  const row=await updateLineAccountTag(c.env.DB,tenantOf(c),c.req.param('id'),input);
  if(!row) return c.json({success:false,error:'フォルダが見つかりません'},404);
  auditLog(c,'line_account_folder.update',{kind:'line_account_folder',id:row.id});
  return c.json({success:true,data:folder(row)});
});
lineAccountFolders.delete('/api/line-account-folders/:id',requireRole('owner','admin'),denyReadOnly(),async c => {
  const id=c.req.param('id');
  if(!await getLineAccountTag(c.env.DB,tenantOf(c),id)) return c.json({success:false,error:'フォルダが見つかりません'},404);
  await deleteLineAccountTag(c.env.DB,tenantOf(c),id);
  auditLog(c,'line_account_folder.delete',{kind:'line_account_folder',id});
  return c.json({success:true,data:{id}});
});
lineAccountFolders.put('/api/line-accounts/:id/folder',requireRole('owner','admin'),denyReadOnly(),async c => {
  const id=c.req.param('id'),tenant=tenantOf(c);
  if(!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[id])) return c.json({success:false,error:'アカウントが見つかりません'},404);
  const account=await getLineAccountById(c.env.DB,id);
  if(!account) return c.json({success:false,error:'アカウントが見つかりません'},404);
  if(account.archived_at) return c.json({success:false,error:'ACCOUNT_ARCHIVED'},409);
  const body=await c.req.json<{folderId?:unknown}>().catch(()=>null),folderId=body?.folderId;
  if(folderId!==null && (typeof folderId!=='string' || !folderId)) return c.json({success:false,error:'folderIdはフォルダIDかnullを指定してください'},400);
  const row=folderId===null ? null : await getLineAccountTag(c.env.DB,tenant,folderId as string);
  if(folderId!==null&&!row) return c.json({success:false,error:'同じ統括のフォルダを選んでください'},400);
  if(!await replaceLineAccountTags(c.env.DB,tenant,id,folderId===null?[]:[folderId as string])) return c.json({success:false,error:'ACCOUNT_ARCHIVED'},409);
  auditLog(c,'line_account_folder.move',{kind:'line_account',id},{lineAccountId:id});
  return c.json({success:true,data:{id,folderId,folder:row?folder(row):null}});
});
