const kind = { type:'string',enum:['project','image'] };
const id = {in:'path',name:'id',required:true,schema:{type:'string'}};
const responses = {'200':{description:'保存・並べ替え・アーカイブ成功'},'403':{description:'更新権限なし'},'404':{description:'同じ統括・種類のフォルダがない'},'409':{description:'版の競合または名前の重複'},'422':{description:'入力不正'}};
const body = (required:string[],properties:Record<string,unknown>)=>({required:true,content:{'application/json':{schema:{type:'object',required,properties}}}});
const revisions = {withId:{type:'string'},expectedRevision:{type:'integer',minimum:1},withExpectedRevision:{type:'integer',minimum:1}};
export const folderUpgradePaths = {
 '/api/hq/banners/folders':{
  get:{tags:['HQ Banners'],summary:'バナーの種類別フォルダと件数',parameters:[{in:'query',name:'kind',required:true,schema:kind}],responses},
  post:{tags:['HQ Banners'],summary:'バナーのフォルダを作る',requestBody:body(['kind','name'],{kind,name:{type:'string',minLength:1,maxLength:100},color:{type:['string','null']}}),responses:{...responses,'201':{description:'作成成功'}}},
 },
 '/api/hq/banners/folders/{id}':{
  patch:{tags:['HQ Banners'],summary:'名前と色を版確認付きで変更',parameters:[id],requestBody:body(['kind','expectedRevision'],{kind,name:{type:'string',minLength:1,maxLength:100},color:{type:['string','null']},expectedRevision:revisions.expectedRevision}),responses},
  delete:{tags:['HQ Banners'],summary:'内容を未分類に戻しフォルダをアーカイブ',parameters:[id],requestBody:body(['kind','expectedRevision'],{kind,expectedRevision:revisions.expectedRevision}),responses},
 },
 '/api/hq/banners/folders/{id}/swap-order':{post:{tags:['HQ Banners'],summary:'同じ種類の2フォルダの順番を原子的に交換',parameters:[id],requestBody:body(['kind',...Object.keys(revisions)],{kind,...revisions}),responses}},
 '/api/hq/templates/folders/{id}/swap-order':{post:{tags:['HQ Templates'],summary:'統括テンプレートのフォルダの順番を原子的に交換',parameters:[id],requestBody:body(Object.keys(revisions),revisions),responses}},
 '/api/hq/broadcasts/folders/{id}/swap-order':{post:{tags:['HQ Broadcasts'],summary:'統括配信のフォルダの順番を原子的に交換',parameters:[id],requestBody:body(['withId','expectedVersion','withExpectedVersion'],{withId:revisions.withId,expectedVersion:revisions.expectedRevision,withExpectedVersion:revisions.withExpectedRevision}),responses}},
};
