import type { SqliteD1 } from './d1-sqlite.js';

/** 移行前からある7行を持つ店。新しい店の自動作成とは分けて送信の回帰を試す。 */
export function seedExistingRestaurantFollowup(t: SqliteD1, storeId: string) {
  const scenario=`restaurant-followup:${storeId}`;
  t.raw.prepare(`INSERT INTO scenarios(id,name,description,trigger_type,is_active,line_account_id)
    SELECT ?,'LINE来店フォロー：'||name,'予約ごとの起点から送る共通シナリオ','manual',0,line_account_id FROM rt_stores WHERE id=?`).run(scenario,storeId);
  t.raw.prepare('INSERT INTO rt_store_followup_templates(store_id,scenario_id) VALUES(?,?)').run(storeId,scenario);
  const rows:[string,number,string][]=[
    ['reservation_created',0,'予約が入りました。'],['reservation_24h',-1440,'明日はご予約の日です。'],
    ['reservation_2h',-120,'ご来店をお待ちしています。'],['post_visit',180,'ご来店ありがとうございました。'],
    ['review_request',181,'よろしければ口コミをお寄せください。'],
    ['waitlist_invited',0,'空きが出ました。\nこの時間で予約する：{{var.waitlist_book_url}}\n今回は見送る：{{var.waitlist_decline_url}}'],
    ['anniversary_before',-10080,'もうすぐ記念日ですね。ご来店をお待ちしています。'],
  ];
  for(const [i,[trigger,offset,text]] of rows.entries()) {
    const step=`${scenario}:${trigger}`;
    const flex={type:'bubble',body:{type:'box',layout:'vertical',contents:[{type:'text',text:'{{name}}さん、{{var.reservation_datetime}}のご予約の確認です。',wrap:true}]},footer:{type:'box',layout:'vertical',contents:[
      {type:'button',action:{type:'postback',label:'行きます',data:'{{var.restaurant_going}}'}},
      {type:'button',action:{type:'postback',label:'変更したい',data:'{{var.restaurant_change}}'}},
      {type:'button',action:{type:'postback',label:'取り消す',data:'{{var.restaurant_cancel}}'}},
    ]}};
    t.raw.prepare('INSERT INTO scenario_steps(id,scenario_id,step_order,message_type,message_content,is_draft) VALUES(?,?,?,?,?,0)').run(step,scenario,i,trigger==='reservation_24h'?'flex':'text',trigger==='reservation_24h'?JSON.stringify(flex):text);
    t.raw.prepare('INSERT INTO rt_store_followup_step_bindings(store_id,trigger,step_id,offset_minutes,enabled) VALUES(?,?,?,?,?)').run(storeId,trigger,step,offset,trigger==='anniversary_before'?0:1);
  }
}
