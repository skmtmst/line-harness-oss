/** 初期セットも編集画面と同じ操作のJSONを保存し、公開時の共通の読み口へ渡す。 */
export function styleMenuActionData(button:{actionType:string;actionData:string}):string {
 return JSON.stringify(button.actionType==='uri'?{uri:button.actionData}:{text:button.actionData});
}
