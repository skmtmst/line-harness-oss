const account={name:'account_id',in:'query',required:true,schema:{type:'string'}};
const id={name:'id',in:'path',required:true,schema:{type:'string'}};
const key={name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',maxLength:128}};
const responses={'200':{description:'取得/再送成功'},'400':{description:'不正な入力'},'401':{description:'未認証'},'403':{description:'権限/閲覧のみ'},'404':{description:'対象外'},'409':{description:'残数/版/再送キーの競合'},'503':{description:'保存先障害'}};
const json=(schema:unknown)=>({required:true,content:{'application/json':{schema}}});
const grant={type:'object',required:['friendId','kind','name','validFrom','expiresAt','reason'],properties:{
  friendId:{type:'string'},menuId:{type:['string','null']},kind:{enum:['ticket','monthly']},name:{type:'string',maxLength:100},
  remaining:{type:'integer',minimum:0},monthlyLimit:{type:['integer','null'],minimum:1,description:'nullは月の上限なし。省略は不可'},validFrom:{type:'string',format:'date-time'},expiresAt:{type:'string',format:'date-time'},reason:{type:'string',minLength:1,maxLength:1000},
}};
export const bookingEntitlementPaths={
  '/api/liff/booking/requests':{post:{tags:['Booking'],summary:'本人の予約を申し込む',description:'AuthorizationにLIFF IDトークン必須。券と支払い方法は併用不可。customer_choiceでpayment_method省略時は店の既定を使用し、店も選択式なら登録した決済先に従う。確定時に券を1回減らす。',security:[],parameters:[{name:'liffId',in:'query',required:true,schema:{type:'string'}},key,{name:'Authorization',in:'header',required:true,schema:{type:'string'}}],requestBody:json({type:'object',required:['menu_id','staff_id','starts_at'],properties:{menu_id:{type:'string'},staff_id:{type:'string'},starts_at:{type:'string',format:'date-time'},customer_note:{type:'string'},waitlist_id:{type:'string'},entitlement_id:{type:'string'},payment_method:{enum:['onsite','online']}}}),responses:{...responses,'201':{description:'booking_id/status/payment_requiredと必要な支払いID/期限'},'422':{description:'空き枠/メニュー不一致'}}}},
  '/api/booking/admin/entitlements':{
    get:{tags:['Booking'],summary:'友だちの回数券・月謝を読む',parameters:[account,{name:'friend_id',in:'query',required:true,schema:{type:'string'}}],responses},
    post:{tags:['Booking'],summary:'回数券・月謝を手動で付与',description:'予約編集権限。ticketはremaining、monthlyはmonthlyLimit。理由必須。実決済なし。',parameters:[account,key],requestBody:json(grant),responses:{...responses,'201':{description:'付与した券'}}},
  },
  '/api/booking/admin/entitlements/{id}/operations':{post:{tags:['Booking'],summary:'残数調整・期限延長・取消',parameters:[account,id,key],requestBody:json({type:'object',required:['action','reason','expectedVersion'],properties:{action:{enum:['adjust','extend','revoke']},reason:{type:'string'},expectedVersion:{type:'integer',minimum:1},remaining:{type:'integer',minimum:0},periodAt:{type:'string',format:'date-time',description:'月謝の残数を調整する月の日時。省略は今月'},expiresAt:{type:'string',format:'date-time'}}}),responses}},
  '/api/booking/admin/entitlements/{id}/history':{get:{tags:['Booking'],summary:'理由と操作者を含む変更履歴',parameters:[account,id,{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}},{name:'offset',in:'query',schema:{type:'integer',minimum:0}}],responses}},
  '/api/liff/booking/entitlements':{get:{tags:['Booking'],summary:'本人の回数券・月謝の残りと予約日時点の利用可否',description:'LIFF IDトークン必須。監査理由・担当者は返さない。',security:[],parameters:[{name:'liffId',in:'query',required:true,schema:{type:'string'}},{name:'Authorization',in:'header',required:true,schema:{type:'string'}},{name:'starts_at',in:'query',schema:{type:'string',format:'date-time'}},{name:'menu_id',in:'query',schema:{type:'string'}},{name:'event_id',in:'query',schema:{type:'string'},description:'同じアカウントの公開クラスに使える券を照合'}],responses}},
};
