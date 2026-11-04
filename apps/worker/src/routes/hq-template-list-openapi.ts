import { api17TemplateKind } from './api17-openapi.js';
const catalogStoreUpdate = {
  get: { tags:['HQ Templates'], summary:'店に届いた統括の新版を確認する', parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}},{name:'accountId',in:'query',required:true,schema:{type:'string'}}], responses:{'200':{description:'判断待ちの新版、または未着'},'403':{description:'閲覧権限なし'},'404':{description:'店舗が見つからない'}} },
  post: { tags:['HQ Templates'], summary:'店に届いた版を取り込むか現在のまま維持する', parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}},{name:'accountId',in:'query',required:true,schema:{type:'string'}}], requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['decisionId','action','snapshot'],properties:{decisionId:{type:'string'},action:{type:'string',enum:['adopt','keep']},snapshot:{type:'string'}}}}}}, responses:{'200':{description:'判断を保存'},'403':{description:'編集権限なし'},'404':{description:'店舗が見つからない'},'409':{description:'版または店の内容が変更された'}} },
};
export const hqTemplateListPaths = {
'/api/booking/admin/menus/{id}/hq-update': catalogStoreUpdate,
'/api/mileage/rewards/{id}/hq-update': catalogStoreUpdate,
'/api/hq/templates/{id}/catalog-redistribution-preview': {
  post: { tags:['HQ Templates'], summary:'配り直す前に店舗の版と変更を確認する', parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['accountIds'],properties:{accountIds:{type:'array',items:{type:'string'}}}}}}}, responses:{'200':{description:'店舗ごとの対象と確認用の版'},'403':{description:'統括または店舗の権限なし'},'409':{description:'対象が変更された'}} },
},
'/api/hq/templates/{id}/catalog-redistribution': {
  post: { tags:['HQ Templates'], summary:'確認した店舗にひな形を配り直す', parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['templateVersionId','stores'],properties:{templateVersionId:{type:'string'},stores:{type:'array',items:{type:'object',required:['accountId','snapshot','preflightId'],properties:{accountId:{type:'string'},snapshot:{type:'string'},preflightId:{type:'string'}}}}}}}}}, responses:{'200':{description:'店舗ごとの更新・判断待ち・競合'},'403':{description:'統括または店舗の権限なし'},'409':{description:'ひな形の版が変更された'}} },
},
'/api/hq/templates': {
      get: {
        tags: ['HQ Templates'],
        summary: '統括ひな形一覧を取得',
        description: 'statusはactive（既定）/archived/all。archive_countsは同じtype/kindに対するactive/archivedの件数で、選択中statusには依存しない。保管行もarchived_atとrevisionを返す。各メッセージ行に message_count（保存版のLINE通数、カルーセルは1通）と has_interpolations（差し込みの有無）を返す。未取得はnull。type=mark/kind=support_markではstats.supportStatusに受信箱の状態別人数、stats.markChangesに現在の有効店の可視友だちについて記録された直近168時間の変更件数を返す。自由なマークの名前で対応状況を推測しない。変更履歴はrecorded_events_onlyで完全性を保証しない。',
        parameters: [{name:'status',in:'query',schema:{type:'string',enum:['active','archived','all'],default:'active'}},
          {name:'kind',in:'query',schema:{type:'string',enum:[...api17TemplateKind.enum,'tag','friend_field','support_mark']},description:'メッセージの種類または友だち属性で絞る。kind_countsは絞り込み前の件数。'},
          {name:'type',in:'query',schema:{type:'string',enum:['tag','rich_menu','template','form','scenario','friend_field','mark','auto_reply','friend_add_rule','reminder','booking_menu','mileage_reward']}},
          {name:'message_count',in:'query',schema:{type:'string',enum:['single','multiple']},description:'1通・複数通で絞る。未取得の版はどちらにも含めない。複数通の作成機能とは別。'},
          {name:'has_interpolations',in:'query',schema:{type:'boolean'},description:'本文・カード・質問・素材の差し込みの有無。名前・ファイル名は含めない。未取得をfalseにしない。'},
        ],
        responses: { '200': { description: 'Tenant-scoped template list' }, '400': { description: 'Invalid template type' }, '403': { description: 'Owner or admin role required' } },
      },
      post: {
        tags: ['HQ Templates'],
        summary: '統括ひな形を作成',
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' }, description: '再送時も同じ値を使用する作成依頼ID。省略時はbody.requestIdが必須' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['type', 'name', 'definition'], properties: {
            requestId: { type: 'string' }, type: { type: 'string', enum: ['tag','rich_menu','template','form','scenario','friend_field','mark','auto_reply','friend_add_rule','reminder','booking_menu','mileage_reward'] },
            name: { type: 'string', minLength: 1 }, description: { type: 'string' }, definition: { type: 'object' },
          } } } },
        },
        responses: { '201': { description: 'Created, or the same idempotent result' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' }, '409': { description: 'Idempotency conflict' } },
      },
    },
};
