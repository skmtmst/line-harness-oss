const kind={type:'string',enum:['message','carousel','rich_message','question','coupon','research']};
const id={name:'id',in:'path',required:true,schema:{type:'string'}};
const color={type:['string','null'],pattern:'^#[0-9a-fA-F]{6}$'};
const folder={type:'object',required:['id','kind','name','parentId','color','displayOrder'],properties:{id:{type:'string'},kind:{const:'line_account'},name:{type:'string'},parentId:{type:'null'},color,displayOrder:{type:'integer',minimum:0},itemCount:{type:'integer',minimum:0},createdAt:{type:'string'},updatedAt:{type:'string'}}};
const input={type:'object',properties:{name:{type:'string',minLength:1,maxLength:100},color,displayOrder:{type:'integer',minimum:0}}};
const response=(description:string,data:unknown)=>({description,content:{'application/json':{schema:{type:'object',properties:{success:{const:true},data}}}}});
const body=(schema:unknown)=>({required:true,content:{'application/json':{schema}}});
const writeErrors={'400':{description:'入力が不正'},'403':{description:'オーナー・管理者の編集権限が必要'},'409':{description:'同名フォルダまたは変更の競合'}};
export const api17Paths={
  '/api/line-account-folders':{
    get:{tags:['LINE Accounts'],summary:'統括のフォルダと閲覧可能アカウントの件数',responses:{'200':response('フォルダ・全件数・未分類の件数',{type:'object',properties:{folders:{type:'array',items:folder},total:{type:'integer'},unclassifiedCount:{type:'integer'}}})}},
    post:{tags:['LINE Accounts'],summary:'統括のアカウントフォルダを作成',requestBody:body({...input,required:['name']}),responses:{'201':response('作成したフォルダ',folder),...writeErrors}},
  },
  '/api/line-account-folders/{id}':{
    patch:{tags:['LINE Accounts'],summary:'名前・色・並び順を変更',parameters:[id],requestBody:body({...input,minProperties:1}),responses:{'200':response('変更後のフォルダ',folder),'404':{description:'同じ統括のフォルダがない'},...writeErrors}},
    delete:{tags:['LINE Accounts'],summary:'フォルダを削除し、アカウントを未分類にする',parameters:[id],responses:{'200':response('削除したID',{type:'object',properties:{id:{type:'string'}}}),'404':{description:'同じ統括のフォルダがない'},...writeErrors}},
  },
  '/api/line-accounts/{id}/folder':{
    put:{tags:['LINE Accounts'],summary:'アカウントを1つのフォルダへ移動（nullは未分類）',parameters:[id],requestBody:body({type:'object',required:['folderId'],properties:{folderId:{type:['string','null']}}}),responses:{'200':response('移動後の所属',{type:'object',properties:{id:{type:'string'},folderId:{type:['string','null']},folder:{anyOf:[folder,{type:'null'}]}}}),'404':{description:'アカウントがない・担当範囲外'},...writeErrors}},
  },
  '/api/hq/templates/kind-counts':{
    get:{tags:['HQ Templates'],summary:'統括テンプレートの6種類ごとの件数',responses:{'200':response('全6種類の件数',{type:'object',properties:Object.fromEntries(kind.enum.map(k=>[k,{type:'integer',minimum:0}]))}),'403':{description:'統括権限が必要'}}},
  },
};
export const api17TemplateKind=kind;
