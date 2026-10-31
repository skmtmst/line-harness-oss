import type { StarterCatalogSelection, StarterCatalogDetails } from '@line-crm/shared';
import { catalogSelection } from './style-starter-catalog-definition.js';
import type { RichMenuHqDefinition } from './hq-templates/rich-menu.js';

/** 保存した版を読む。初期セットの画面から本文やボタンを書き換える口は持たない。 */
export async function catalogDetails(db:D1Database,tenant:string,selection:StarterCatalogSelection):Promise<StarterCatalogDetails> {
  const row=await catalogSelection(db,tenant,selection);
  const d=JSON.parse(row.definition_json);
  const detail:StarterCatalogDetails={...selection,name:row.name,version:row.version,lines:[]};
  const add=(label:string,value:unknown)=>{if(typeof value==='string'&&value)detail.lines.push({label,value})};
  if(selection.kind==='rich_menu') {
    const menu=(d as RichMenuHqDefinition).richMenu;
    detail.pages=[];
    for(const page of menu.pages) {
      const areas=[];
      for(const area of page.areas) {
        let destination=({form:'回答フォーム',template:'テンプレート',booking:'予約',booking_history:'予約履歴',visit_stamp:'来店スタンプ',tel:'電話',text:'メッセージ',switch:'ページ切替',url:'URL'} as Record<string,string>)[area.intent??'']??'タップ操作';
        if(area.intent==='url'||area.intent==='tel')destination=String(area.actionData.uri??destination);
        if(area.intent==='text')destination=String(area.actionData.text??destination);
        if(area.actionType==='richmenuswitch')destination=menu.pages.find(p=>p.id===area.actionData.targetPageId)?.name??'ページ切替';
        if(area.formId) {
          const form=await db.prepare('SELECT name FROM forms f WHERE f.id=? AND EXISTS(SELECT 1 FROM form_accounts fa JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND a.tenant_id=?)').bind(area.formId,tenant).first<{name:string}>();
          destination=`回答フォーム：${form?.name??'参照先を確認してください'}`;
        }
        if(area.templateId) {
          const template=await db.prepare('SELECT t.name FROM templates t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND a.tenant_id=?').bind(area.templateId,tenant).first<{name:string}>();
          destination=`テンプレート：${template?.name??'参照先を確認してください'}`;
        }
        areas.push({label:area.label??`ボタン${areas.length+1}`,destination,...area.bounds});
      }
      detail.pages.push({name:page.name,width:2500,height:menu.size==='large'?1686:843,areas});
    }
  } else if(selection.kind==='template'||selection.kind==='coupon') {
    add('名前',d.template?.name); add('本文',d.template?.messageContent);add('タイトル',d.asset?.payload?.title);add('説明',d.asset?.payload?.description);
    if(d.card){add('タイトル',d.card.title);add('説明',d.card.text)}
  } else if(selection.kind==='tag') { add('名前',d.tag?.name);add('説明',d.tag?.description); }
  else if(selection.kind==='form') { add('説明',d.form?.description);for(const field of d.form?.fields??[])add('質問',field.label); }
  else if(selection.kind==='auto_reply') {add('名前',d.settings?.name);add('キーワード',d.settings?.keyword);if(d.settings?.responseType==='text')add('本文',d.settings.responseContent);}
  return detail;
}
