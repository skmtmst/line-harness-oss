const query=(name:string,schema:Record<string,unknown>)=>({name,in:'query',required:false,schema});
const id={name:'id',in:'path',required:true,schema:{type:'string'}};
const results={200:{description:'保存された設定と同じ所属・版で取得'},400:{description:'入力が不正'},403:{description:'統括の権限が必要'},404:{description:'対象がない'},409:{description:'版または参照が変わった'}};
export const api5Paths={
 '/api/hq/templates/media':{get:{tags:['HQ Templates'],summary:'統括で取り込んだ動画・音声を取得',parameters:[query('kind',{type:'string',enum:['video','audio']}),query('limit',{type:'integer',minimum:1,maximum:100}),query('cursor',{type:'string'})],responses:results}},
 '/api/hq/templates/resources':{get:{tags:['HQ Templates'],summary:'店を区別してタグ・公開クーポン・シナリオを名前で探す',parameters:[query('kind',{type:'string',enum:['tag','coupon','scenario']}),query('q',{type:'string',maxLength:100}),query('accountIds',{type:'string',description:'最大30店、カンマ区切り・重複不可'}),query('limit',{type:'integer',minimum:1,maximum:100}),query('cursor',{type:'integer',minimum:0})],responses:results}},
 '/api/hq/templates/{id}/distribution-targets':{get:{tags:['HQ Templates'],summary:'配布先が受け取った版を取得（配布前確認は別途必須）',parameters:[id,query('accountIds',{type:'string',description:'最大30店、カンマ区切り・省略時は全有効店'})],responses:results}},
 '/api/hq/templates/rich-menu-preview':{post:{tags:['HQ Templates'],summary:'リッチメニューの店別参照と画像・同名の有無を保存前に確認',requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['name','accountIds'],properties:{name:{type:'string',maxLength:200},accountIds:{type:'array',minItems:1,maxItems:30,items:{type:'string'}},definition:{type:'object',description:'HqRichMenuDefinition。bookingMenuName・useTrackedLink・displayAudience・defaultOpenも検査'}}}}}},responses:results}},
 '/api/hq/templates/{id}/test-send':{post:{tags:['HQ Templates'],summary:'フォームの下書きを送信・回答保存なしで確認',parameters:[id],requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:{expectedRevision:{type:'integer',minimum:1},answers:{type:'object'}}}}}},responses:results}},
"/api/hq/templates/message-references": {
    "get": {
      "tags": [
        "HQ Templates"
      ],
      "summary": "配布先の回答フォーム・シナリオの候補を取得",
      "parameters": [],
      "responses": {
        "200": {
          "description": "成功",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ApiResponse"
              }
            }
          }
        },
        "403": {
          "description": "権限がありません"
        },
        "409": {
          "description": "確認した版や対象が変わりました"
        },
        "422": {
          "description": "入力を確認してください"
        }
      }
    }
  },
};
