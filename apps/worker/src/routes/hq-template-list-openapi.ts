import { api17TemplateKind } from './api17-openapi.js';
export const hqTemplateListPaths = {
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
