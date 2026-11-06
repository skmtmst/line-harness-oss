const account = { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } };
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const mediaId = { type: 'string', nullable: true, minLength: 1, maxLength: 200 };
const slots = ['exterior', 'interior', 'waiting'];
const responses = {
  '200': { description: '保存後の version。写真と使用台帳を同時に更新する。' },
  '400': { description: '写真の形が不正、他店・共有・退避済み・画像以外のメディア' },
  '403': { description: '閲覧のみ、対象の編集権限なし、所属外アカウント' },
  '404': { description: '対象が存在しない・他店・取り下げ済み' },
  '409': { description: '版競合。再送せず入力を残し、最新を確認する。' },
  '503': { description: '保存失敗。成功として表示しない。' },
};
const single = (permission: string) => ({
  tags: ['Booking'], summary: '予約写真を登録メディアから選ぶ・外す',
  description: `${permission} の編集権限が必要。1枚だけ。nullで解除。expectedVersionは写真一覧が返した版を使う。使用中の写真はメディアから削除できない。`,
  parameters: [account, id],
  requestBody: { required: true, content: { 'application/json': { schema: {
    type: 'object', required: ['expectedVersion', 'mediaId'],
    properties: { expectedVersion: { type: 'integer', minimum: 1 }, mediaId },
  } } } }, responses,
});

export const bookingPhotosPaths = {
  '/api/booking/admin/menus/photos': { get: {
    tags: ['Booking'], summary: '予約設定のメニュー・スタッフ・店の写真を取得',
    parameters: [account], responses: { '200': { description: 'menus/staffのid,name,version,photo。storeのversion,photos,order,visibility（3枠の公開可否）。photoは{mediaId,url}またはnull。未設定の店はversion=0。' }, '403': responses['403'], '503': { description: '写真を読み込めない' } },
  } },
  '/api/booking/admin/menus/{id}/photo': { put: single('/booking/menus') },
  '/api/booking/admin/staff/{id}/photo': { put: single('booking.settings') },
  '/api/booking/admin/store-photos': { put: {
    tags: ['Booking'], summary: '外観・店内・待合の写真と表示順をまとめて保存',
    description: 'booking.settingsの編集権限。各1枚・最大3枚。設定なしはexpectedVersion=0、既存は現在の版。省略した枠を推測せず3枠すべて必須。初回は既存と同じ承認ありの設定で作る。',
    parameters: [account], requestBody: { required: true, content: { 'application/json': { schema: {
      type: 'object', required: ['expectedVersion', 'photos', 'order'], properties: {
        expectedVersion: { type: 'integer', minimum: 0 },
        photos: { type: 'object', additionalProperties: false, required: slots, properties: { exterior: mediaId, interior: mediaId, waiting: mediaId } },
        visibility: { type: 'object', additionalProperties: false, required: slots, properties: { exterior: { type: 'boolean' }, interior: { type: 'boolean' }, waiting: { type: 'boolean' } }, description: '省略時は選択済みの公開設定を保持。未設定は全て非公開。写真と同じ版で保存。' },
        order: { type: 'array', minItems: 3, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: slots } },
      },
    } } } }, responses,
  } },
  '/api/liff/booking/store-photos': { get: {
    tags: ['Booking'], summary: 'LIFFのお店の案内に表示する写真を保存順で取得',
    security: [], parameters: [{ name: 'liffId', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { '200': { description: 'success:true,data:[{slot,url}]。公開を選んだ写真だけ。0枚なら空配列。管理用メディアID・版を返さない。' }, '404': { description: '未登録・無効なLIFF' }, '503': { description: '写真を読み込めない' } },
  } },
};
