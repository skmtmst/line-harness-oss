export const broadcastUploadPaths = {
  '/api/broadcast-message-assets/upload-sessions': {
    post: { tags:['Broadcasts'],summary:'R2への直接アップロードを準備する',
      requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['filename','mimeType','sizeBytes'],properties:{lineAccountId:{type:['string','null']},filename:{type:'string'},mimeType:{enum:['video/mp4','image/jpeg','image/png']},sizeBytes:{type:'integer',minimum:1,maximum:209715200}}}}}},
      responses:{'201':{description:'15分有効の署名付きPUT URLと必須ヘッダー'},'403':{description:'配信の編集権限または所属がない'},'503':{description:'直接アップロード未設定'}} },
  },
  '/api/broadcast-message-assets/upload-sessions/{id}/complete': {
    post:{tags:['Broadcasts'],summary:'容量・形式・所属・ETagを検査して配信用URLを返す',parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['etag'],properties:{etag:{type:'string'}}}}}},responses:{'201':{description:'安全性の検査対象として登録し、配信用URLを発行'},'200':{description:'確定済みの再要求'},'409':{description:'期限切れまたは内容不一致'},'422':{description:'ファイルの形式が不正'}}},
  },
};
