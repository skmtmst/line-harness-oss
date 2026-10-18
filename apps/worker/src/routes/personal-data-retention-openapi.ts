export const personalDataRetentionPaths = {
  '/api/account-settings/personal-data-retention': {
    get: { tags:['Settings'], summary:'店の個人情報の保存期限と保留を読む', parameters:[{name:'accountId',in:'query',required:true,schema:{type:'string'}}], responses:{'200':{description:'version and policy'},'403':{description:'Forbidden'},'503':{description:'Invalid saved policy'}} },
    put: { tags:['Settings'], summary:'本人確認と版の照合後に保存期限を変更する', requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['accountId','expectedVersion','policy'],properties:{accountId:{type:'string'},expectedVersion:{type:'integer',minimum:0},policy:{type:'object',required:['enabled','hold','responseDays','blockedFriendDays'],properties:{enabled:{type:'boolean'},hold:{type:'boolean'},responseDays:{type:'integer',minimum:1,maximum:3650},blockedFriendDays:{type:'integer',minimum:1,maximum:3650}}}}}}}},responses:{'200':{description:'Saved version and policy'},'401':{description:'STEP_UP_REQUIRED (privacy.retention)'},'403':{description:'Forbidden'},'409':{description:'SAVE_CONFLICT'},'422':{description:'Invalid policy'}} },
  },
};
