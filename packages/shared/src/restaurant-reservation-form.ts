import { phoneProblem } from './phone.js';

/** 専用の席予約の設定。管理画面の見本と実際のLIFFが同じ定義を読む。 */
export const RESTAURANT_RESERVATION_FIELD_IDS=['name','dateTime','guestCount','phone','allergy','note'] as const;
export type RestaurantReservationFieldId=typeof RESTAURANT_RESERVATION_FIELD_IDS[number];
export interface RestaurantReservationField {
 id:RestaurantReservationFieldId;
 label:string;
 enabled:boolean;
 required:boolean;
}
export interface RestaurantReservationForm {
 title:string;
 completionMessage:string;
 fields:RestaurantReservationField[];
}
export type RestaurantReservationFormHealth={available:true}|{available:false;message:string;repairPath:string};
export interface RestaurantReservationFormRepair extends RestaurantReservationFormSettings {repairToken:string}
export interface RestaurantReservationFormSettings {
 version:number;
 definition:RestaurantReservationForm;
}
export interface RestaurantReservationAnswers {
 customerName?:string|null;
 customerPhone?:string|null;
 allergyNote?:string|null;
 note?:string|null;
}
/** 管理画面の必須設定は、確定APIとLIFFの両方で同じ条件で検査する。 */
export function restaurantReservationAnswerError(form:RestaurantReservationForm,answers:RestaurantReservationAnswers):string|null{
 const values={name:answers.customerName,phone:answers.customerPhone,allergy:answers.allergyNote,note:answers.note};
 for(const field of form.fields){
  if(!(field.id in values))continue;
  const value=values[field.id as keyof typeof values];
  if(value!=null&&typeof value!=='string')return `${field.label}を確認してください`;
  if(field.enabled&&field.required&&!value?.trim())return `${field.label}を入れてください`;
  const max=field.id==='name'?100:field.id==='phone'?50:200;
  if(value&&[...value].length>max)return `${field.label}は${max}文字以内で入れてください`;
 }
 return answers.customerPhone?phoneProblem(answers.customerPhone)||null:null;
}
export const RESTAURANT_RESERVATION_REQUIRED_FIELDS:readonly RestaurantReservationFieldId[]=['name','dateTime','guestCount'];
export function defaultRestaurantReservationForm():RestaurantReservationForm{
 return {title:'ご予約',completionMessage:'ご予約を受け付けました。内容をご確認ください。',fields:[
  {id:'name',label:'お名前',enabled:true,required:true},
  {id:'dateTime',label:'日にち・時間',enabled:true,required:true},
  {id:'guestCount',label:'人数',enabled:true,required:true},
  {id:'phone',label:'電話番号',enabled:true,required:false},
  {id:'allergy',label:'アレルギー',enabled:true,required:false},
  {id:'note',label:'ご要望',enabled:true,required:false},
 ]};
}
export function parseRestaurantReservationForm(value:unknown):
 {ok:true;value:RestaurantReservationForm}|{ok:false;error:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))return {ok:false,error:'予約フォームの設定を確認してください'};
 const input=value as Record<string,unknown>;
 if(typeof input.title!=='string'||!input.title.trim()||[...input.title.trim()].length>80)return {ok:false,error:'題名は1〜80文字で入れてください'};
 if(typeof input.completionMessage!=='string'||!input.completionMessage.trim()||[...input.completionMessage.trim()].length>500)return {ok:false,error:'完了後の文は1〜500文字で入れてください'};
 if(!Array.isArray(input.fields)||input.fields.length!==RESTAURANT_RESERVATION_FIELD_IDS.length)return {ok:false,error:'予約に必要な項目は外せません'};
 const fields:RestaurantReservationField[]=[],seen=new Set<string>();
 for(const candidate of input.fields){
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return {ok:false,error:'聞く項目を確認してください'};
  const field=candidate as Record<string,unknown>;
  if(typeof field.id!=='string'||!RESTAURANT_RESERVATION_FIELD_IDS.some(id=>id===field.id)||seen.has(field.id))return {ok:false,error:'聞く項目が重複しているか、使えない項目です'};
  if(typeof field.label!=='string'||!field.label.trim()||[...field.label.trim()].length>50||typeof field.enabled!=='boolean'||typeof field.required!=='boolean')return {ok:false,error:'項目の名前と必須の設定を確認してください'};
  const id=field.id as RestaurantReservationFieldId;
  if(RESTAURANT_RESERVATION_REQUIRED_FIELDS.includes(id)&&(!field.enabled||!field.required))return {ok:false,error:'お名前・日時・人数は、表示する必須項目です'};
  if(field.required&&!field.enabled)return {ok:false,error:'必須の項目は表示してください'};
  fields.push({id,label:field.label.trim(),enabled:field.enabled,required:field.required});seen.add(id);
 }
 return {ok:true,value:{title:input.title.trim(),completionMessage:input.completionMessage.trim(),fields}};
}
