import { initialRestaurantStore,initialRestaurantStoreGuard } from './style-initial-store.js';
import { initialMenuDocumentText,collectInputs, initialFormKey, initialMenuFormTargets, initialMenuIsDocument, INITIAL_MENUS, type AccountStyle, type FormLayout, type FormBookingConfig, type FormBlock, type InitialMenuTarget } from '@line-crm/shared';

export const initialFormTargets = initialMenuFormTargets;
export function initialFormName(style: AccountStyle, target: InitialMenuTarget) {
 return INITIAL_MENUS[style].buttons.find(button => button.target===target)?.label ?? 'ご案内';
}
/** 実在する店・メニューを一意に決められないときは空の下書きにして、公開前の確認で止める。 */
async function bookingConfig(db:D1Database,account:string,style:AccountStyle):Promise<FormBookingConfig> {
 if(style==='restaurant') {
  return {kind:'seats',storeId:await initialRestaurantStore(db,account)??'',menuId:'',daysAhead:30};
 }
 const menus=await db.prepare('SELECT id FROM menus WHERE line_account_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY id LIMIT 2').bind(account).all<{id:string}>();
 return {kind:'people',menuId:menus.results.length===1?menus.results[0]!.id:'',allowMenuSelection:true,daysAhead:30};
}
export async function initialFormLayout(db:D1Database,account:string,style:AccountStyle,target:InitialMenuTarget):Promise<FormLayout> {
 const title=initialFormName(style,target);
 const blocks:FormBlock[]=[];
 if(target==='booking') blocks.push({id:'booking',kind:'input',type:'booking',name:'booking',label:'ご予約の日時',required:true,booking:await bookingConfig(db,account,style)});
 else if(initialMenuIsDocument(target)) blocks.push({id:'information',kind:'text',text:initialMenuDocumentText(target)});
 else blocks.push({id:'name',kind:'input',type:'text',name:'name',label:'お名前',required:true},{id:'message',kind:'input',type:'textarea',name:'message',label:target==='application'?'お申し込み内容':'お問い合わせ内容',required:true});
 return {version:2,header:[],sections:[{id:'main',name:title,blocks}],options:{submitLabel:target==='booking'?'予約内容を送る':'送信する',thanksText:'内容を受け付けました。',restorePrevious:false,afterActions:[]}};
}
export const initialFormIsDocument=(target:InitialMenuTarget)=>initialMenuIsDocument(target);
export {initialFormKey};


export function initialFormScopeGuards(db:D1Database,account:string,layout:FormLayout):D1PreparedStatement[] {
 return collectInputs(layout).flatMap(block=>{
  if(block.type!=='booking'||!block.booking)return [];
  if(block.booking.kind==='seats')return block.booking.storeId?[initialRestaurantStoreGuard(db,account,block.booking.storeId)]:[];
  return block.booking.menuId?[db.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM menus WHERE id=? AND line_account_id=? AND is_active=1 AND deleted_at IS NULL) THEN '{}' ELSE 'STYLE_VERSION_CONFLICT' END)`).bind(block.booking.menuId,account)]:[];
 });
}
