import { describe, expect, it } from 'vitest';
import { tapExtrasError, validateTapExtrasTree, collectTapExtraTagIds } from './tap-extras.js';
import { convertBroadcastAsset } from './broadcast-asset-conversion.js';
import { parseHqMessageCard, composeHqMessageCard } from './hq-message-card.js';

describe('押されたときの追加処理の契約', () => {
  it('種類なしの整数スコアと複数タグだけを受け付ける', () => {
    expect(tapExtrasError({tagIds:['tag-a','tag-b'],scoreChange:-10})).toBeNull();
    for (const value of [{scoreChange:1.5},{scoreChange:Infinity},{scoreType:'buy',scoreChange:10},{tagIds:[7]},{tagIds:Array(101).fill('t')}]) expect(tapExtrasError(value)).toBeTruthy();
  });
  it('入れ子のボタンとリサーチの選択肢を検査しタグを重複なしで拾う', () => {
    const value={cards:[{tapExtras:{tagIds:['t1'],scoreChange:10}}],questions:[{choiceTapExtras:[{tagIds:['t1','t2']},{}]}]};
    expect(validateTapExtrasTree(value)).toBeNull();
    expect(collectTapExtraTagIds(value)).toEqual(['t1','t2']);
    expect(validateTapExtrasTree({questions:[{choiceTapExtras:'bad'}]})).toBeTruthy();
    expect(validateTapExtrasTree({questions:[{choiceTapExtras:[{scoreChange:0.5}]}]})).toBeTruthy();
  });
  it('カードと画像のURLアクションへ設定を渡す', () => {
    const extras={tagIds:['t1'],scoreChange:10};
    const result=convertBroadcastAsset('card_message','案内',{cards:[{title:'案内',description:'内容',actionType:'uri',actionUrl:'https://example.test',tapExtras:extras}]});
    expect(result.ok).toBe(true);
    if(result.ok) expect(JSON.parse(result.message.messageContent)[0].actions[0].tapExtras).toEqual(extras);
    const rich=convertBroadcastAsset('rich_message','案内',{baseUrl:'https://example.test/image',imageUrl:'https://example.test/image/1040',baseSize:{width:1040,height:1040},tapAreas:[{x:0,y:0,width:100,height:100,actionType:'uri',uri:'https://example.test',tapExtras:extras}]});
    expect(rich.ok).toBe(true);
    if(rich.ok) expect(JSON.parse(rich.message.messageContent).actions[0].tapExtras).toEqual(extras);
  });
  it('リッチのテキストにも追加処理を保存し、400文字までの検査を保つ', () => {
    const tapExtras={tagIds:['t1'],scoreChange:10};
    const payload={baseUrl:'https://example.test/image',imageUrl:'https://example.test/image/1040',baseSize:{width:1040,height:520},tapAreas:[{x:0,y:0,width:100,height:100,actionType:'message',text:'予約したい',tapExtras}]};
    const rich=convertBroadcastAsset('rich_message','案内',payload);
    expect(rich.ok).toBe(true);
    if(rich.ok) expect(JSON.parse(rich.message.messageContent).actions).toEqual([{type:'message',text:'予約したい',tapExtras,area:{x:0,y:0,width:1040,height:520}}]);
    for(const message of ['', 'あ'.repeat(401)]) expect(convertBroadcastAsset('rich_message','案内',{...payload,tapAreas:[{...payload.tapAreas[0],text:message}]}).ok).toBe(false);
    expect(convertBroadcastAsset('rich_message','案内',{...payload,tapAreas:[{...payload.tapAreas[0],text:'あ'.repeat(400)}]}).ok).toBe(true);
  });
  it('統括カードの保存と配布で追加処理を保つ', () => {
    const tapExtras={tagIds:['t1'],scoreChange:10};
    const card=parseHqMessageCard({format:'flex',title:'案内',body:'本文',buttons:[{id:'b',label:'開く',action:'url',value:'https://example.test',tapExtras}]});
    expect(JSON.parse(composeHqMessageCard(card,'t').messageContent).footer.contents[0].action.tapExtras).toEqual(tapExtras);
    expect(()=>parseHqMessageCard({...card,buttons:[{...card.buttons[0],tapExtras:{scoreChange:1.5}}]})).toThrow();
  });
  it('リサーチの押下には配信した公開版と選択肢の番号を固定する', () => {
    const payload={assetId:'r',assetVersion:2,questions:[{text:'続けますか',format:'single',required:true,choices:['はい','いいえ'],choiceTapExtras:[{scoreChange:10},{scoreChange:100}]}]};
    const result=convertBroadcastAsset('research','調査',payload);
    expect(result.ok).toBe(true);
    if(result.ok) expect(JSON.parse(result.message.messageContent).footer.contents.map((b:{action:{data:string}})=>b.action.data)).toEqual(['research:r:2:0:0','research:r:2:0:1']);
    expect(convertBroadcastAsset('research','調査',{...payload,assetVersion:undefined}).ok).toBe(false);
  });
});
