const account = { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } };
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const responses = {
  '200': { description: '担当範囲の設定・集計・操作結果。取得できない値はnull。' },
  '400': { description: '入力が不正' }, '403': { description: '権限がない・閲覧のみ' },
  '404': { description: '対象がない・担当範囲外' }, '409': { description: '保存後に状態・世代が変わった。読み直して比較する。' },
};
const body = (properties: Record<string, unknown>, required: string[]) => ({ required: true, content: { 'application/json': { schema: { type: 'object', properties, required } } } });
export const api2FollowupPaths = {
  '/api/friends/{id}/delivery-consents': {get:{summary:'担当範囲の友だちの配信停止・同意を読む。未登録は明示同意の証拠ではない。',parameters:[id],responses}},
  '/api/friends/{id}/delivery-consents/{purpose}': {put:{
    summary:'owner/adminが配信停止・同意の状態を理由と読込版付きで保存。全ての目的のうち1つでもunknown/revokedなら自動配信を止める。',
    parameters:[id,{name:'purpose',in:'path',required:true,schema:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,79}$'}}],
    requestBody:body({state:{type:'string',enum:['granted','unknown','revoked']},reason:{type:'string',minLength:1,maxLength:1000},expectedVersion:{type:'integer',minimum:0}},['state','reason','expectedVersion']),responses,
  }},
  '/api/booking/admin/channels/{channel}/settings': { put: {
    summary: '外部予約経路の連携希望を開始・停止する（外部接続は行わない）',
    parameters: [account, { name: 'channel', in: 'path', required: true, schema: { type: 'string', enum: ['hot_pepper_beauty','google_reserve','epark'] } }],
    requestBody: body({ enabled: { type: 'boolean' }, expectedVersion: { type: 'integer', minimum: 0 } }, ['enabled','expectedVersion']), responses,
  } },
  '/api/restaurant-test/channel-close-tasks': { get: {
    summary: '媒体作業を予約経路・媒体で絞る。sourceは発生時の経路。複数起点はtriggerSourcesに保持し、どの起点経路でも絞れる。source=nullは複数経路・過去の不明・休業。openedは同世代の再開確認。',
    parameters: [account, ...['storeId','source','channel'].map(name=>({ name, in:'query', required:name==='storeId', schema:{type:'string'} }))], responses,
  } },
  '/api/restaurant-test/channel-close-tasks/{id}/opened': { post: {
    summary: 'もう開けてよい知らせに、開けた印を付ける。status=reopenのままopened=true。', parameters: [account,id],
    requestBody: body({ expectedGeneration: { type: 'integer', minimum: 1 } }, ['expectedGeneration']), responses,
  } },
  '/api/restaurant-test/google/reviews/{id}/draft/generate': { post: {
    summary: '既存AIで返信下書きを生成・短縮・敬語に整形し保存する。Googleへ公開しない。', parameters: [account,id],
    requestBody: { ...body({ mode:{type:'string',enum:['generate','shorten','polite'],default:'generate'},replyDraft:{type:'string',maxLength:4096} }, []), required:false },
    responses: { ...responses, '502':{description:'AI失敗。下書きを保持'},'503':{description:'AI未設定'},'504':{description:'AI時間切れ'} },
  } },
  '/api/manual-links/lookup': { get: {
    summary:'正本表から、確認済みのマニュアルまたはガイドだけを引く。未設定・開けないURLはnull。',
    parameters:[{name:'screen',in:'query',schema:{type:'string'}},{name:'key',in:'query',schema:{type:'string'}},{name:'keyKind',in:'query',schema:{type:'string',enum:['screen','task'],default:'screen'}}],responses,
  } },
  '/api/hq/support/summary': { get: {
    summary:'統括自身の問い合わせ件数・今月/前月の解決件数・最初の返信までの平均時間（時間単位）を全件で集計。未返信だけなら平均null。', responses,
  } },
};
