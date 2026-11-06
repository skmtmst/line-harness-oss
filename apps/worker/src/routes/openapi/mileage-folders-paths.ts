export const mileageFolderPaths = {
  '/api/mileage/reward-folders': {
    get: { tags: ['Mileage'], summary: '使い道のフォルダと件数を読む', parameters: [{ name: 'accountId', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Folders: id, name, displayOrder, count' }, '404': { description: 'Account not found' } } },
    post: { tags: ['Mileage'], summary: '使い道のフォルダを作る（統括・管理者）', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'name'], properties: { accountId: { type: 'string' }, name: { type: 'string', minLength: 1, maxLength: 100 } } } } } }, responses: { '201': { description: 'Created folder' }, '403': { description: 'Forbidden' }, '404': { description: 'Account not found' }, '422': { description: 'Invalid name' } } },
  },
  '/api/mileage/reward-folders/order': {
    put: { tags: ['Mileage'], summary: 'アカウントの全フォルダを並べ替える（統括・管理者）', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'ids'], properties: { accountId: { type: 'string' }, ids: { type: 'array', uniqueItems: true, items: { type: 'string' } } } } } } }, responses: { '200': { description: 'Ordered folders' }, '403': { description: 'Forbidden' }, '404': { description: 'Account not found' }, '422': { description: 'All account folder IDs required exactly once' } } },
  },
  '/api/mileage/rewards/{id}/folder': {
    put: { tags: ['Mileage'], summary: '使い道をフォルダに入れる（nullは未分類、統括・管理者）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'folderId'], properties: { accountId: { type: 'string' }, folderId: { type: ['string', 'null'] } } } } } }, responses: { '200': { description: 'Reward with folderId' }, '403': { description: 'Forbidden' }, '404': { description: 'Account, reward or folder not found' }, '422': { description: 'Invalid folderId' } } },
  },
};
