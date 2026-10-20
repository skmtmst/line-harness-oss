// Definitions only. Runtime handlers remain in their feature routes.
export const hqBannersPaths = {
  // ── HQ Banners ─────────────────────────────────────────────────────────
  '/api/hq/banners/presets': {
    get: {
      tags: ['HQ Banners'], summary: 'バナー用途と生成上限を取得',
      responses: { '200': { description: 'Presets and tenant usage limits' }, '403': { description: 'Owner or admin role required' } },
    },
  },
  '/api/hq/banners/usage': {
    get: {
      tags: ['HQ Banners'], summary: 'バナー生成の月次・日次利用量を取得',
      responses: { '200': { description: 'Tenant banner usage' }, '403': { description: 'Owner or admin role required' } },
    },
  },
  '/api/hq/banners/stats': {
    get: {
      tags: ['HQ Banners'], summary: 'バナー生成画面の集計値を取得',
      responses: { '200': { description: 'Tenant banner project and image statistics' }, '403': { description: 'Owner or admin role required' } },
    },
  },
  '/api/hq/banners/projects': {
    get: {
      tags: ['HQ Banners'], summary: 'バナープロジェクト一覧を取得',
      parameters: [
        { name: 'archived', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Tenant-scoped banner projects' }, '403': { description: 'Owner or admin role required' } },
    },
    post: {
      tags: ['HQ Banners'], summary: 'バナープロジェクトを作成',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 }, description: { type: 'string' } } } } } },
      responses: { '201': { description: 'Created' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' } },
    },
  },
  '/api/hq/banners/projects/{id}': {
    get: {
      tags: ['HQ Banners'], summary: 'バナープロジェクトの詳細を取得',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Project detail with images and generations' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
    patch: {
      tags: ['HQ Banners'], summary: 'バナープロジェクトを更新',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, isFavorite: { type: 'boolean' }, archived: { type: 'boolean' } } } } } },
      responses: { '200': { description: 'Updated' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
  },
  '/api/hq/banners/projects/{id}/duplicate': {
    post: {
      tags: ['HQ Banners'], summary: 'バナープロジェクトを複製',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '201': { description: 'Duplicated' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
  },
  '/api/hq/banners/projects/{id}/generations': {
    post: {
      tags: ['HQ Banners'], summary: 'バナー生成条件を登録',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { '201': { description: 'Generation queued' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' }, '429': { description: 'Usage limit or circuit breaker reached' } },
    },
  },
  '/api/hq/banners/projects/{id}/uploads': {
    post: {
      tags: ['HQ Banners'], summary: '手持ち画像をプロジェクトへ取り込む',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } } } },
      responses: { '201': { description: 'Uploaded' }, '403': { description: 'Owner or admin role required' }, '413': { description: 'Image exceeds size limit' }, '422': { description: 'Unsupported image' } },
    },
  },
  '/api/hq/banners/generations/{id}': {
    get: {
      tags: ['HQ Banners'], summary: 'バナー生成の進捗を取得',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Generation status' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
  },
  '/api/hq/banners/generations/{id}/run': {
    post: {
      tags: ['HQ Banners'], summary: 'バナーを1枚生成して保存',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { gravity: { type: 'string', enum: ['center', 'top', 'bottom'], description: '用途寸法へ切り抜くときに残す位置。無ければ中央。' } } } } } },
      responses: { '200': { description: 'One image generated' }, '400': { description: 'Invalid crop position' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '422': { description: 'Image request rejected' }, '502': { description: 'Image provider failure' } },
    },
  },
  '/api/hq/banners/generations/{id}/cancel': {
    post: {
      tags: ['HQ Banners'], summary: '残りのバナー生成を中止',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Cancelled' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
  },
  '/api/images/{key}': {
    get: {
      tags: ['Media'],
      summary: 'Read an uploaded image within the authenticated staff account scope',
      parameters: [
        { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Owned image bytes', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } },
        '401': { description: 'Authentication required' },
        '404': { description: 'Image not found within the account scope' },
      },
    },
  },
  '/api/hq/banners/images': {
    get: {
      tags: ['HQ Banners'], summary: '統括のバナー画像一覧を取得',
      parameters: [
        { name: 'projectId', in: 'query', schema: { type: 'string' } },
        { name: 'favorite', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
        { name: 'preset', in: 'query', schema: { type: 'string' } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'before', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      ],
      responses: { '200': { description: 'Tenant-scoped banner images' }, '403': { description: 'Owner or admin role required' } },
    },
  },
  '/api/hq/banners/images/{id}': {
    get: {
      tags: ['HQ Banners'], summary: 'バナー画像の詳細を取得',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Image detail and generation conditions' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
    patch: {
      tags: ['HQ Banners'], summary: 'バナー画像のお気に入り・所属を更新',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { isFavorite: { type: 'boolean' }, projectId: { type: ['string', 'null'] } } } } } },
      responses: { '200': { description: 'Updated' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
    delete: {
      tags: ['HQ Banners'], summary: 'バナー画像を一覧から外す',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Removed from the tenant library' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
  },
  '/api/hq/banners/images/{id}/deliver': {
    post: {
      tags: ['HQ Banners'], summary: 'バナー画像を選択店舗へ渡す',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lineAccountIds'], properties: { lineAccountIds: { type: 'array', maxItems: 50, items: { type: 'string' } } } } } } },
      responses: { '200': { description: 'Per-account delivery results' }, '400': { description: 'Invalid account selection' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
    },
  },
};
