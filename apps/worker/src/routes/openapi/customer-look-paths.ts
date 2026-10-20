export const customerLookPaths = {
  '/api/account-settings/customer-look': {
    get: { tags:['Account Settings'], summary:'店のお客さまのデザインを読む', parameters:[{name:'accountId',in:'query',required:true,schema:{type:'string'}}], responses:{'200':{description:'保存した版とデザイン'},'403':{description:'担当外'}} },
    put: { tags:['Account Settings'], summary:'店のお客さまのデザインを保存（オーナー・管理者）', requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['accountId','expectedVersion','look'],properties:{accountId:{type:'string'},expectedVersion:{type:'integer',minimum:0},look:{type:'object'}}}}}}, responses:{'200':{description:'保存した版とデザイン'},'403':{description:'変更権限なし・担当外'},'409':{description:'保存の版が競合'},'422':{description:'色・型・書体が不正'}} },
  },
  '/api/account-settings/allergy-options': {
    get: { tags:['Account Settings'],summary:'店のアレルギー選択肢',parameters:[{name:'accountId',in:'query',required:true,schema:{type:'string'}}],responses:{'200':{description:'選択肢と版'},'403':{description:'担当外'}} },
    put: { tags:['Account Settings'],summary:'店のアレルギー選択肢を保存',requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['accountId','expectedVersion','options'],properties:{accountId:{type:'string'},expectedVersion:{type:'integer',minimum:0},options:{type:'array',maxItems:32,items:{type:'string',maxLength:100}}}}}}},responses:{'200':{description:'選択肢を保存'},'403':{description:'変更権限なし・担当外'},'409':{description:'保存の版が競合'},'422':{description:'選択肢が不正'}} },
  },
  '/api/liff/customer-look': {get:{tags:['LIFF'],summary:'保存済みのお客さまのデザイン（予約機能に依存しない）',security:[],parameters:[{name:'liffId',in:'query',required:true,schema:{type:'string'}}],responses:{'200':{description:'保存した版・型・公開用の色と書体'},'400':{description:'LIFF IDなし'},'404':{description:'不明なLIFF ID'}}}},
};
