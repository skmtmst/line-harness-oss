import { describe,it,expect } from 'vitest';
import { convertBroadcastAsset,richMessageActions,splitBroadcastText,validateFlexMessage } from '@line-crm/shared';
import { buildMessage } from './line-message.js';
import { buildMessage as scenarioBuild } from './step-delivery.js';
import { parseBroadcastMessageParts,buildMessages } from './broadcast-message-set.js';
import { validateTemplateMessage } from './template-message-validation.js';
import { keywordMatches } from './auto-reply.js';

// LINE公式のnojs版で確認: imagemap 1040px・50操作、Flex 12枚・30/50KB、送信5通。
// https://developers.line.biz/ja/reference/messaging-api/nojs/
describe('LINEに渡すメッセージの公式契約',()=> {
  const rich={baseUrl:'https://example.com/images/imagemaps/a',imageUrl:'https://example.com/a.png',baseSize:{width:1040,height:520},tapAreas:[
    {x:0,y:0,width:50,height:100,actionType:'uri',uri:'https://example.com/left'},
    {x:50,y:0,width:50,height:100,actionType:'message',text:'予約'},
  ]};
  it('リッチはuri/messageの範囲を保持し、一斉配信とシナリオが同じJSONを送る',()=> {
    const result=convertBroadcastAsset('rich_message','予約案内',rich);
    expect(result.ok).toBe(true); if(!result.ok)return;
    const message=buildMessage(result.message.messageType,result.message.messageContent,result.message.altText);
    expect(message).toEqual({type:'imagemap',baseUrl:rich.baseUrl,altText:'予約案内',baseSize:{width:1040,height:520},actions:[
      {type:'uri',linkUri:'https://example.com/left',area:{x:0,y:0,width:520,height:520}},
      {type:'message',text:'予約',area:{x:520,y:0,width:520,height:520}},
    ]});
    expect(scenarioBuild('rich_message',JSON.stringify({...rich,assetName:'予約案内'}))).toEqual(message);
    const parts=parseBroadcastMessageParts({messageType:'text',messageContent:'',messageBubbles:[{id:'r',type:'rich_message',content:{...rich,assetName:'予約案内'}}]});
    expect(buildMessages(parts)).toEqual([message]);
  });
  it('51操作・負座標・画像外・postback・ゼロ幅は保存前に人の言葉で止める',()=> {
    expect(richMessageActions({...rich,tapAreas:Array(51).fill(rich.tapAreas[0])},520).error).toContain('50個');
    for(const bad of [{x:-1},{width:101},{width:0},{actionType:'postback'}])expect(richMessageActions({...rich,tapAreas:[{...rich.tapAreas[0],...bad}]},520).error).toBeTruthy();
    const thirds=[0,33.33,66.67].map(x=>({x,y:0,width:33.33,height:100,actionType:'message',text:'確認'}));
    const areas=richMessageActions({...rich,tapAreas:thirds},520).actions! as Array<{area:{x:number;width:number}}>;
    expect(areas[2].area.x+areas[2].area.width).toBe(1040);
    expect(richMessageActions({...rich,coordinateUnit:'px',tapAreas:[{x:0,y:0,width:1040,height:520,actionType:'message',text:'確認'}]},520).error).toBeUndefined();
  });
  it('クーポンは画像・題・期限・回数・使用postbackを保持する',()=> {
    const result=convertBroadcastAsset('coupon','来店のお礼',{assetId:'coupon-1',description:'500円引き',imageUrl:'https://example.com/c.png',startsAt:'2026-10-01T00:00',endsAt:'2026-11-01T00:00',maxUsesPerFriend:2});
    expect(result.ok).toBe(true);if(!result.ok)return;
    const message=buildMessage(result.message.messageType,result.message.messageContent,result.message.altText);
    expect(message.type).toBe('flex');
    expect(result.message.messageContent).toContain('coupon_use:coupon-1');
    expect(result.message.messageContent).toContain('1人2回まで');
    expect(result.message.messageContent).toContain('2026-11-01');
    expect(result.message.messageContent).toContain('https://example.com/c.png');
    expect(validateFlexMessage(JSON.parse(result.message.messageContent))).toBeNull();
  });
  const bubble={type:'bubble',body:{type:'box',layout:'vertical',contents:[{type:'text',text:'本文'}]}};
  it('Flexは12枚まで、UTF-8容量を1枚30KB・全体50KBまでに制限する',()=> {
    expect(validateTemplateMessage('flex',JSON.stringify({type:'carousel',contents:Array(12).fill(bubble)})).ok).toBe(true);
    expect(validateTemplateMessage('flex',JSON.stringify({type:'carousel',contents:Array(13).fill(bubble)}))).toMatchObject({ok:false,error:'カードは1〜12枚で設定してください'});
    expect(validateFlexMessage({...bubble,body:{...bubble.body,contents:[{type:'text',text:'あ'.repeat(10300)}]}})).toContain('30KB');
    const big={...bubble,body:{...bubble.body,contents:[{type:'text',text:'あ'.repeat(9000)}]}};
    expect(validateFlexMessage({type:'carousel',contents:[big,big]})).toContain('50KB');
    expect(validateTemplateMessage('flex','{壊れた').ok).toBe(false);
  });
  it('改行・文末で4500字以内に分割し、文章を欠落・重複させない',()=> {
    const text='あ'.repeat(4400)+'。\n'+'🌿'.repeat(4000)+'。'+'い'.repeat(2200);
    const chunks=splitBroadcastText(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every(part=>Array.from(part).length<=4500)).toBe(true);
    expect(chunks[0].endsWith('\n')).toBe(true);
    expect(parseBroadcastMessageParts({messageType:'text',messageContent:'あ'.repeat(4501)})).toHaveLength(2);
    expect(()=>parseBroadcastMessageParts({messageType:'text',messageContent:'あ'.repeat(22501)})).toThrow('5通');
  });
  it('追加ボタンをLINEのURIボタンとして送り、分割後と合わせて5通を超える保存を拒否する',()=> {
    const input={messageType:'text',messageContent:'本文',messageOptions:{buttons:[{label:'詳しく見る',type:'url',value:'https://example.com/guide'},{label:'予約',type:'postback',value:'reserve'}]}};
    const messages=buildMessages(parseBroadcastMessageParts(input));
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages[1])).toContain('https://example.com/guide');
    expect(JSON.stringify(messages[1])).toContain('\"type\":\"postback\"');
    expect(JSON.stringify(messages[1])).toContain('\"data\":\"reserve\"');
    expect(()=>parseBroadcastMessageParts({...input,messageContent:'あ'.repeat(22500)})).toThrow('5通');
  });
  it('キーワードは既定で全角半角・大小文字・前後空白をそろえ、ルールごとにそのまま当てられる',()=> {
    const rule={keyword:'LINE',match_type:'exact'};
    expect(keywordMatches(rule,' \nＬｉｎｅ　')).toBe(true);
    expect(keywordMatches({...rule,normalize_keywords:false},' \nＬｉｎｅ　')).toBe(false);
    expect(keywordMatches({...rule,normalize_keywords:false},'LINE')).toBe(true);
  });
});
