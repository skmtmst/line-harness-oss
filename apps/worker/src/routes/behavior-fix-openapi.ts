const csvResponse = { description: 'CSV。権限を検査し、選んだアカウントの記録だけを監査後に返す', content: { 'text/csv': { schema: { type: 'string' } } } };
export const behaviorFixPaths = {
  '/api/forms/{id}/exports': {
    post: {
      tags: ['Forms'], summary: '回答をCSVで書き出す', security: [{ bearerAuth: [] }],
      description: '閲覧のみは403。スタッフは編集可能なフォーム範囲とform.submission.exportが必要。回答を見るGETは書き出しには使わない。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '200': csvResponse, '403': { description: '書き出し権限なし' }, '404': { description: '対象外' } },
    },
  },
  '/api/mileage/exports': {
    post: {
      tags: ['Mileage'], summary: 'マイル・行動スコアをCSVで書き出す', security: [{ bearerAuth: [] }],
      description: '閲覧のみ・スタッフは403。ownerまたは明示権限のあるadminだけ。scoresはaction_score.list.export、その他はmileage.ledger.export。理由を監査に残す。',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'kind', 'reason'], properties: {
        accountId: { type: 'string' }, kind: { type: 'string', enum: ['balances','history','rewards','scores'] }, reason: { type: 'string', minLength: 1, maxLength: 300 },
      } } } } },
      responses: { '200': csvResponse, '400': { description: '理由・種類が不正' }, '403': { description: '書き出し権限なし' }, '404': { description: '対象外' }, '500': { description: '書き出し・監査に失敗' } },
    },
  },
};
