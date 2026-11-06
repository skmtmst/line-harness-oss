const account={name:'account_id',in:'query',required:true,schema:{type:'string'}};
const id={name:'id',in:'path',required:true,schema:{type:'string'}};
const responses={'200':{description:'success:true,data。所属するLINEアカウントのデータだけを返す'},
  '400':{description:'入力不正'},'401':{description:'未認証'},'403':{description:'権限不足・閲覧のみの更新'},
  '404':{description:'対象外・存在しない'},'409':{description:'版競合または通知を別の処理が再読込中'},'503':{description:'保存先未準備（code: *_storage_not_ready）またはDB障害'}};
const filters=[{name:'q',schema:{type:'string',maxLength:200}},
  {name:'status',schema:{enum:['paid','partially_refunded','pending','refunded','expired','onsite']}},
  {name:'method',schema:{enum:['online','onsite']}},{name:'period',schema:{enum:['month','7d','30d','90d'],default:'month'}},
  {name:'limit',schema:{type:'integer',minimum:1,maximum:100,default:20}},
  {name:'offset',schema:{type:'integer',minimum:0,maximum:100000,default:0}}].map(f=>({...f,in:'query'}));
const operation=(summary:string,extra:Record<string,unknown>={})=>({tags:['Booking'],summary,parameters:[account],responses,...extra});
const setting=(summary:string,price=false)=>({
  get:operation(summary,{parameters:[account,id],description:'dataはmode（nullは上書きなし）またはunitPriceとversion。未設定はnull/0、version=0。665未適用は503。'}),
  put:operation(summary+'を保存',{parameters:[account,id],requestBody:{required:true,content:{'application/json':{schema:{type:'object',
    required:[price?'unitPrice':'mode'],properties:{...(price?{unitPrice:{type:'integer',minimum:0,maximum:9007199254740991}}:{mode:{type:['string','null'],enum:['none','onsite','online','customer_choice',null]}}),expectedVersion:{type:'integer',minimum:0}}}}}}}),
});
export const bookingPaymentAdminPaths={
  '/api/booking/payments/{id}/refunds':{get:operation('返金履歴を読む',{parameters:[id],description:'owner/admin/staff。data.items:[{id,amount,reason,actorLabel,createdAt,notifyLine,notificationStatus,simulation:true,sent:false}]。所属する店だけ。'})},
  '/api/booking/payments/{id}/booking':{post:operation('未連結の入金記録を予約へ結ぶ',{parameters:[id],description:'owner/adminの編集可能者だけ。既存の他予約・店払い・回数券・別入金への重複連結は409。同じ連結の再送は一度。入金や予約確定は変えない。',requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['bookingId','reason'],properties:{bookingId:{type:'string'},reason:{type:'string',minLength:1,maxLength:500}}}}}}})},
  '/api/booking/admin/payment-connection':{
    get:operation('予約用Stripe接続の状態',{description:'663の接続記録からconnected/testMode/末尾4文字/connectedAtを返す。記録なし・切断済みは未接続。dashboardUrlはnull。秘密値や完全なアカウントIDは返さない。'}),
    delete:operation('試験用Stripeのつなぎを外す',{description:'owner/adminの管理セッション必須。Stripe test secretだけを使ってdeauthorizeし、成功後に切断日時を保存。決済はしない。処理中409、失敗503。682が必要。'}),
  },
  '/api/booking/admin/payment-connection/authorize':{post:operation('試験用Stripeの接続・つなぎ直しURLを作る',{description:'owner/adminの管理セッション必須。data:{authorizationUrl,expiresAt,testMode:true}。一回限りのstateは10分。同じ店の古いpendingを無効化。682が必要。本番鍵は拒否。'})},
  '/api/booking/admin/payment-connection/callback':{
    get:operation('Stripeからの戻りを検証して試験接続を保存',{parameters:[{name:'state',in:'query',required:true,schema:{type:'string'}},{name:'code',in:'query',schema:{type:'string'}},{name:'error',in:'query',schema:{enum:['access_denied']}}],description:'認証必須。開始時と同じ管理セッション・担当者・店の権限を照合。stateを一度だけ消費して交換、livemode=false/read_writeのみ保存。JSONで接続状態を返す。自動再送不可。API鍵認証は拒否。'}),
    post:operation('同じ管理セッションで認可コードを交換',{requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['state'],properties:{state:{type:'string'},code:{type:'string'},error:{enum:['access_denied']}}}}}},description:'GETと同じ照合。{state,code} または {state,error:access_denied}。返り値はStripe接続状態。'}),
  },
  '/api/booking/admin/menu-payments':{get:operation('予約メニューのお支払いの上書き一覧',{description:'data.menus: [{menuId,mode}]。削除済みメニューは除外。コース/クラスも665の保存済み上書きを含む。'})},
  '/api/booking/admin/payments':{get:operation('お支払いの記録・検索・今月の集計',{parameters:[account,...filters],description:'data:{items,total,summary}。一覧期間は作成日時、summaryは店時間の今月で検索条件と独立。入金総額には今月入金後に返金した分を含む。返金は697の増分履歴を店の今月で集計。一部返金はpartially_refunded、refundedAmountは累計額。actorLabelとreasonは最新操作。旧全額返金のみrefunded_at/updated_atを使う。unpaidはpending、failedは画面型に無いため一覧対象外。店払いは予約時の保存済み選択だけ。領収書URLは署名確認した通知の保存値、未取得ならnull。'})},
  '/api/booking/admin/payments/export':{get:operation('同じ検索条件の全件CSV',{parameters:[account,...filters],responses:{...responses,'200':{description:'UTF-8 BOM、数式対策済みCSV。メモ・決済識別子・秘密値は含めない',content:{'text/csv':{schema:{type:'string'}}}},'413':{description:'1万件超過。範囲を絞って再実行。切り詰めなし'}}})},
  '/api/booking/admin/staff/today-counts':{get:operation('店時間で担当者ごとの今日の予定・確定・完了件数',{description:'data:{items:[{staffId,todayCount}],date,timezone}。取消等を除き0件も返す。'})},
  '/api/booking/admin/payments/{id}/send-link':{post:operation('支払いリンクの模擬生成（実送信なし）',{parameters:[account,id],description:'owner/admin、閲覧のみ不可。既存のStripe模擬決済を再利用。data:{paymentId,checkoutUrl,sent:false,simulation:true}。実送信成功として扱わない。',requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['dryRun'],properties:{dryRun:{const:true}}}}}},responses:{...responses,'409':{description:'模擬Stripe対象外・支払い対象外'}}})},
  '/api/booking/admin/payment-events':{get:operation('支払い通知の一覧',{parameters:[account,{name:'result',in:'query',schema:{enum:['applied','duplicate','failed']}},{name:'period',in:'query',schema:{enum:['7d','30d','90d']}},{name:'limit',in:'query',schema:{type:'integer',maximum:100}}]})},
  '/api/booking/admin/payment-events/{id}/replay':{post:operation('支払い通知を再読込（外部通信なし・監査付き）',{parameters:[account,id]})},
  '/api/events/admin/events/{id}/payment':setting('クラスの支払い設定を読む'),
  '/api/events/admin/events/{id}/price':setting('クラス1回の値段を読む',true),
  '/api/restaurant-test/menus/{id}/payment':setting('コースの支払い設定を読む'),
};
