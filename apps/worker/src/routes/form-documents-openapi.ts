const setting = { type: 'object', required: ['identityRetentionDays'], properties: { identityRetentionDays: { type: 'integer', minimum: 1, maximum: 3650 } } };
const account = [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string' } }];
export const formDocumentPaths = {
  '/api/forms/{id}/files': {
    post: { tags: ['Forms'], summary: 'LINE本人確認付きで写真・PDF・本人確認書類を受け取る', description: 'block_id を指定するとprivateに保存し、fileIdを返す。検査中の添付は回答送信に使えない。未指定は既存の写真添付互換口。本人確認書類は保存設定の日数（既定90日）で消える。',
      security: [],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'block_id', in: 'query', schema: { type: 'string' } }, { name: 'side', in: 'query', schema: { type: 'string', enum: ['single','front','back'] } }, { name: 'filename', in: 'query', schema: { type: 'string' } }, { name: 'test_token', in: 'query', schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
      responses: { '201': { description: '添付のfileIdと検査状態' }, '400': { description: '形式・容量10MB・添付の質問・面が不正' }, '401': { description: 'LINE本人確認が必要' }, '403': { description: '試し合言葉が無効' }, '404': { description: 'フォームまたは友だちが範囲外' }, '422': { description: '危険な中身を検出' } } },
  },
  '/api/form-files/{id}/content': {
    get: { tags: ['Forms'], summary: '検査済みの添付書類を認証付きで読む', description: '同じアカウントの閲覧権限が必要。本人確認書類はオーナー・管理者だけ。private/no-storeで返す。公開画像の口では読めない。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: '画像またはPDFのバイナリ' }, '401': { description: '未認証' }, '403': { description: '見る権限がありません' }, '404': { description: '対象アカウントに書類なし' }, '409': { description: '検査中・隔離中' }, '410': { description: '期限で消しました' } } },
  },
  '/api/forms/document-settings/{accountId}': {
    get: { tags: ['Forms'], summary: '本人確認書類の保存日数を読む（オーナー・管理者）', parameters: account,
      responses: { '200': { description: 'identityRetentionDays。未設定は90日。', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: setting } } } } }, '403': { description: '権限なし' }, '404': { description: 'アカウント範囲外' } } },
    put: { tags: ['Forms'], summary: 'これから受け取る本人確認書類の保存日数を変える', parameters: account,
      requestBody: { required: true, content: { 'application/json': { schema: setting } } }, responses: { '200': { description: '保存成功' }, '400': { description: '日数が範囲外' }, '403': { description: '権限なし・閲覧のみ' }, '404': { description: 'アカウント範囲外' } } },
  },
};
