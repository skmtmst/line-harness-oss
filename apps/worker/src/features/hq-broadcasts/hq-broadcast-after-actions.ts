import type { HqBroadcastInput } from '@line-crm/shared';
import { StampError, stampId } from '../../services/visit-stamps.js';

/** 統括も店と同じ固定した公開版を使う。店のIDを別の店へ流用しない。 */
export function validateHqAfterActionSelection(input:HqBroadcastInput,accountIds:string[]) {
 const map=input.afterActionVersionIds;
 if(input.afterActionVersionId!==undefined&&input.afterActionVersionId!==null)stampId(input.afterActionVersionId);
 if(map!==undefined&&(!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).length>100))throw new StampError('店ごとの配信後の処理を確認してください',400,['afterActionVersionIds']);
 if(input.afterActionVersionId&&map&&Object.keys(map).length)throw new StampError('配信後の処理は1つの形式で指定してください',400,['afterActionVersionId','afterActionVersionIds']);
 if(input.afterActionVersionId&&accountIds.length!==1)throw new StampError('複数の店では店ごとに配信後の処理の公開版を選んでください',400,['afterActionVersionIds']);
 for(const [id,version] of Object.entries(map??{})) {
  if(!accountIds.includes(id))throw new StampError('対象外の店の配信後の処理は指定できません',400,['afterActionVersionIds']);
  stampId(id);if(version!==null)stampId(version);
 }
}
export async function hqAfterAction(db:D1Database,input:HqBroadcastInput,accountId:string) {
 const versionId=input.afterActionVersionIds?.[accountId]??input.afterActionVersionId??null;
 if(!versionId)return null;
 const row=await db.prepare(`SELECT v.id,v.version_number AS versionNumber,a.id AS actionId,a.name,v.action_config AS actionsJson
  FROM common_action_versions v JOIN common_actions a ON a.id=v.common_action_id
  WHERE v.id=? AND a.line_account_id=? AND v.status='published' AND a.status='published' AND a.archived_at IS NULL`)
  .bind(versionId,accountId).first<{id:string;versionNumber:number;actionId:string;name:string;actionsJson:string}>();
 if(!row)throw new StampError('同じ店の公開中の配信後の処理を選び直してください',409,['afterActionVersionId','afterActionVersionIds']);
 return {...row,actionCount:JSON.parse(row.actionsJson).length as number};
}
