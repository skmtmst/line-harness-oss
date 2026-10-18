import { normalizeScopedTagName } from '@line-crm/db';
import type { TagCsvImportRowResult, TagCsvImportSummary } from '@line-crm/shared';
import type { HqTemplateAuthority } from './contract.js';
import { HqTemplateError, saveTemplate } from './distribution.js';

type Planned=TagCsvImportRowResult & {folderId:string|null};
function summary(rows:TagCsvImportRowResult[]):TagCsvImportSummary {
  return {total:rows.length,ready:rows.filter(r=>r.status==='ready').length,created:rows.filter(r=>r.status==='created').length,skipped:rows.filter(r=>r.status==='skipped').length,invalid:rows.filter(r=>r.status==='invalid').length,failed:rows.filter(r=>r.status==='failed').length};
}
async function digest(value:string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** Same parsed CSV rows and row outcomes as store import, but only HQ definitions are created. */
export async function importHqTags(db:D1Database,authority:HqTemplateAuthority,input:Record<string,unknown>,execute:boolean) {
  if(!Array.isArray(input.rows)||input.rows.length===0||input.rows.length>500)throw new HqTemplateError('INVALID_IMPORT_ROWS',400,['rows']);
  const existing=(await db.prepare(`SELECT t.name,v.definition_json FROM hq_templates t LEFT JOIN hq_template_versions v ON v.id=t.current_version_id AND v.tenant_id=t.tenant_id
    WHERE t.tenant_id=? AND t.template_type='tag' AND t.friend_attribute_type IS NULL`).bind(authority.tenantId).all<{name:string;definition_json:string|null}>()).results;
  const names=new Set(existing.flatMap(row=>{
    let tagName:string|undefined;try{tagName=JSON.parse(row.definition_json??'{}').tag?.name;}catch{/* The title still reserves the existing name. */}
    return [normalizeScopedTagName(row.name),...(typeof tagName==='string'?[normalizeScopedTagName(tagName)]:[])];
  }));
  const folders=(await db.prepare('SELECT id,name FROM hq_template_folders WHERE tenant_id=? AND archived_at IS NULL').bind(authority.tenantId).all<{id:string;name:string}>()).results;
  const accepted=new Set<string>();
  const planned:Planned[]=input.rows.map((raw,index)=>{
    const v=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
    const name=typeof v.name==='string'?v.name.trim():'',folderName=typeof v.folderName==='string'?v.folderName.trim():'';
    const base={line:Number.isSafeInteger(v.line)&&Number(v.line)>0?Number(v.line):index+2,name,folderName,folderId:null};
    const invalid=(code:TagCsvImportRowResult['code'],message:string):Planned=>({...base,status:'invalid',code,message});
    if(!name)return invalid('name_required','タグ名を入力してください');
    if(Array.from(name).length>60)return invalid('name_too_long','タグ名は60文字以内にしてください');
    if(/[\u0000-\u001f\u007f]/u.test(name))return invalid('invalid_character','改行や制御文字はタグ名に使えません');
    const key=normalizeScopedTagName(name);
    if(names.has(key))return {...base,status:'skipped',code:'already_exists',message:'同じ名前のタグがすでにあります'};
    if(accepted.has(key))return {...base,status:'skipped',code:'duplicate_in_file',message:'CSV内で同じタグ名が重複しています'};
    const matches=folderName?folders.filter(f=>normalizeScopedTagName(f.name)===normalizeScopedTagName(folderName)):[];
    if(matches.length>1)return invalid('folder_ambiguous','同じ名前のフォルダが複数あるため選べません');
    accepted.add(key);
    return {...base,status:'ready',folderId:matches[0]?.id??null,...(folderName&&!matches.length?{code:'folder_not_found' as const,message:'フォルダが見つからないため、未分類として登録します'}:{})};
  });
  for(const row of planned) {
    if(!execute||row.status!=='ready')continue;
    // Re-read before every write; never overwrite an existing definition or distribute to stores.
    const found=await db.prepare(`SELECT id FROM hq_templates WHERE tenant_id=? AND template_type='tag' AND friend_attribute_type IS NULL AND name=?`).bind(authority.tenantId,row.name).first();
    if(found){row.status='skipped';row.code='already_exists';continue;}
    const requestId=`hq-tag-csv-${await digest(normalizeScopedTagName(row.name))}`;
    const prior=await db.prepare(`SELECT resource_id FROM operation_request_receipts WHERE action='hq_template.create' AND actor_id=? AND idempotency_key=?`).bind(`tenant:${authority.tenantId}`,requestId).first<{resource_id:string}>();
    if(prior){row.status='skipped';row.code='already_exists';row.message='この名前はCSVで登録済みです。改名後のタグを確認してください';row.tagId=prior.resource_id;continue;}
    try {
      const result=await saveTemplate(db,authority,{type:'tag',name:row.name,folderId:row.folderId,requestId,
        definition:{schemaVersion:1,tag:{name:row.name,color:'#06C755',description:null,folderId:null},folders:[]}});
      row.status='created';row.tagId=result.template.id;
    } catch(error) {
      if(error instanceof HqTemplateError&&error.code==='IDEMPOTENCY_CONFLICT'){row.status='skipped';row.code='already_exists';row.message='同じ名前のタグが先に登録されたため見送りました';}
      else {row.status='failed';row.code=error instanceof HqTemplateError&&error.code==='INVALID_FOLDER'?'folder_changed':'create_failed';row.message='タグを登録できませんでした。確認し直してください';}
    }
  }
  const rows:TagCsvImportRowResult[]=planned.map(row=>({line:row.line,name:row.name,folderName:row.folderName,status:row.status,...(row.code?{code:row.code}:{}),...(row.message?{message:row.message}:{}),...(row.tagId?{tagId:row.tagId}:{})})),totals=summary(rows);
  return {summary:totals,rows,...(execute?{outcome:totals.invalid+totals.failed>0?(totals.created>0?'partial' as const:'failed' as const):'success' as const}:{})};
}
