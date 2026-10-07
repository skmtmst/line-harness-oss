/** 提案EのAPI契約。権限・本人確認は実ルートでも必ず検証する。 */
type Schema=Record<string,unknown>;
const string:Schema={type:'string'},number:Schema={type:'integer'},bool:Schema={type:'boolean'};
const input=(required:string[],properties:Record<string,Schema>):Schema=>({type:'object',required,properties});
function op(summary:string,properties:Record<string,Schema>={},required:string[]=[],params:string[]=[],liff=false) {
 return {summary,tags:[liff?'Visit stamps LIFF':summary.includes('統括')?'HQ Broadcasts':'Visit stamps'],
   ...(liff?{security:[],description:'管理APIキーは不要。Authorization: Bearer にLINE Login IDトークンを渡し、指定店舗のチャンネルで本人確認する。'}:{}),
   parameters:[...params.map(name=>({name,in:'path',required:true,schema:string})),...(liff?[{name:'accountId',in:'query',required:true,schema:string},{name:'Authorization',in:'header',required:true,schema:string}]:[])],
   ...(Object.keys(properties).length?{requestBody:{required:true,content:{'application/json':{schema:input(required,properties)}}}}:{}),
   responses:{'200':{description:'処理結果。残高・記録・対象店などをdataに返す'},'201':{description:'登録した識別番号をdataに返す'},'400':{description:'入力不正'},'401':{description:'本人確認が必要'},'403':{description:'所属・権限が不足'},'404':{description:'見つからない'},'409':{description:'版・残高・使用状態の競合'},'429':{description:'PINのロック'}}};
}
const card={name:string,accountIds:{type:'array',items:string},settings:{type:'object',description:'mode=visit/amount、amountUnit、maxPerVisit、firstVisitBonus、expiryMonths、timezone、multipliers（期間・曜日・分数帯）、rankMultipliers（タグ名・倍率）、rewards（id・name・stamps）。計算順は基本→初回→時間倍率→最高ランク→切捨て→上限'},expectedVersion:number,active:bool};
export const stampPaths={
 '/api/visit-stamps/cards':{get:op('可視店舗の来店スタンプカード'),post:op('来店スタンプカードを作る',card,Object.keys(card))},
 '/api/visit-stamps/cards/{id}':{put:op('来店スタンプカードの設定と押せる店を保存',card,Object.keys(card),['id'])},
 '/api/visit-stamps/cards/{id}/wallet':{get:{...op('スタンプ残高・有効期限・記録を読む',{},[],['id']),parameters:[{name:'id',in:'path',required:true,schema:string},{name:'accountId',in:'query',required:true,schema:string},{name:'friendId',in:'query',required:true,schema:string}]}},
 '/api/visit-stamps/cards/{id}/grants':{post:op('理由付き手動押印・紙カードの手入力',{accountId:string,friendId:string,count:{type:'integer',minimum:1,maximum:10000},reason:string,requestId:string,source:{type:'string',enum:['manual','paper']}},['accountId','friendId','count','reason','requestId'],['id'])},
 '/api/visit-stamps/entries/{id}/reverse':{post:op('押印・特典使用の記録を取り消して残高を戻す',{reason:string},['reason'],['id'])},
 '/api/visit-stamps/pins/{staffId}':{put:op('店員の4桁PINを設定する。owner/adminのみ',{accountId:string,pin:{type:'string',pattern:'^\\d{4}$',writeOnly:true}},['accountId','pin'],['staffId'])},
 '/api/visit-stamps/paper-requests':{get:{...op('紙カード移行の申請を読む'),parameters:[{name:'accountId',in:'query',required:true,schema:string}]}},
 '/api/visit-stamps/paper-requests/{id}/review':{post:op('紙カード移行を理由付きで承認・却下',{action:{type:'string',enum:['approve','reject']},reason:string},['action','reason'],['id'])},
 '/api/visit-stamps/visits/{kind}/{id}/checkout':{post:op('来店済みの会計から自動押印。同じ来店は二重に押さない',{amount:{type:'integer',minimum:0,maximum:100000000}},['amount'],['kind','id'])},
 '/api/liff/visit-stamps/cards':{get:op('本人のカードと残高',{},[],[],true)},
 '/api/liff/visit-stamps/cards/{id}':{get:op('本人のカード・特典・残高・履歴',{},[],['id'],true)},
 '/api/liff/visit-stamps/cards/{id}/rewards':{post:op('特典を選んで店員に見せる。ここでは使用済みにしない',{rewardId:string,requestId:string},['rewardId','requestId'],['id'],true)},
 '/api/liff/visit-stamps/redemptions/{id}/use':{post:op('店員のPINで一度だけ特典を使う。5回失敗で15分ロック',{staffId:string,pin:{type:'string',pattern:'^\\d{4}$',writeOnly:true}},['staffId','pin'],['id'],true)},
 '/api/liff/visit-stamps/cards/{id}/paper-requests':{post:op('紙カードの写真と押印数を申請。同じカードで承認済み・審査中の重複不可',{photoUrl:{type:'string',format:'uri',pattern:'^https://'},stamps:{type:'integer',minimum:1,maximum:10000}},['photoUrl','stamps'],['id'],true)},
};
