const scenarioParameter={name:'id',in:'path',required:true,schema:{type:'string'}};
export const auditstepsPaths={
 '/api/scenarios/{id}/question-answers':{get:{tags:['Scenarios'],summary:'管理者が途中失敗・成功不明の質問回答を確認する',
  parameters:[scenarioParameter],responses:{'200':{description:'権限のある店舗の未完了回答。executionId・friendId・status・errorCode・updatedAt'},
   '403':{description:'管理者権限なし'},'404':{description:'シナリオが見つからない'}}}},
 '/api/scenarios/{id}/question-answers/{executionId}/resume':{post:{tags:['Scenarios'],summary:'理由を残して未完了工程だけ再開する。返信は再送しない',
  parameters:[scenarioParameter,{name:'executionId',in:'path',required:true,schema:{type:'string'}}],
  requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['reason'],properties:{
   reason:{type:'string',minLength:1,maxLength:500},confirmedChoiceIndex:{type:'integer',minimum:0},
   confirmedCompletedSteps:{type:'array',items:{type:'string'},description:'古い回答は最初の選択肢と、人が確認した完了工程を両方指定する'},
  }}}}},responses:{'200':{description:'再開受付と終了状態。resumed・status'},'400':{description:'理由の入力不正'},
   '403':{description:'管理者権限なし・閲覧のみ'},'404':{description:'回答が見つからない'},'409':{description:'実行中・古い回答の確認不足・再開失敗'}}}},
};
