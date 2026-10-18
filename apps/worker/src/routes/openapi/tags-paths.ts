// Definitions only. Runtime handlers remain in their feature routes.
export const tagsPaths = {
  // ── Tags ────────────────────────────────────────────────────────────────
  '/api/tags': {
    get: { tags: ['Tags'], summary: 'タグ一覧取得', responses: { '200': { description: 'All tags' } } },
    post: {
      tags: ['Tags'],
      summary: 'タグと連動アクション下書きを作成',
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { lineAccountId: { type: 'string' }, name: { type: 'string', minLength: 1, maxLength: 80 }, description: { type: ['string', 'null'] }, groupId: { type: ['string', 'null'] }, isStarred: { type: 'boolean' }, manualAssignmentAllowed: { type: 'boolean' }, reapplyPolicy: { type: 'string', enum: ['first_only', 'every_time'] }, linkedEnabled: { type: 'boolean' }, mileage: { type: 'object' }, automationDraft: { type: 'object' }, applyToExisting: { type: 'boolean', const: false } }, required: ['lineAccountId', 'name', 'reapplyPolicy', 'linkedEnabled', 'mileage'] } } } },
      responses: { '201': { description: 'Tag and common-action draft created' }, '404': { description: 'Account or folder not found' }, '409': { description: 'Normalized name conflict' } },
    },
  },
  '/api/tags/import/preview': {
    post: {
      tags: ['Tags'],
      summary: 'CSV一括登録の事前確認',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['rows'],
              properties: {
                rows: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 500,
                  items: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      line: { type: 'integer', minimum: 1 },
                      name: { type: 'string' },
                      folderName: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '行ごとの登録可否', content: { 'application/json': { schema: { $ref: '#/components/schemas/TagCsvImportData' } } } },
        '400': { description: 'Invalid request' },
        '403': { description: 'Owner or admin role required' },
        '422': { description: 'Too many rows' },
      },
    },
  },
  '/api/tags/import': {
    post: {
      tags: ['Tags'],
      summary: 'CSVからタグを一括登録',
      requestBody: { $ref: '#/paths/~1api~1tags~1import~1preview/post/requestBody' },
      responses: {
        '200': { description: '行ごとの登録結果', content: { 'application/json': { schema: { $ref: '#/components/schemas/TagCsvImportData' } } } },
        '400': { description: 'Invalid request' },
        '403': { description: 'Owner or admin role required' },
        '422': { description: 'Too many rows' },
      },
    },
  },
  '/api/tags/{id}': {
    get: {
      tags: ['Tags'],
      summary: 'タグ設定と連動アクションを取得',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'withActions', in: 'query', schema: { type: 'integer', enum: [1] } },
      ],
      responses: { '200': { description: 'Tag definition' }, '404': { description: 'Not found in account scope' } },
    },
    patch: {
      tags: ['Tags'],
      summary: 'タグ設定と同じ共通アクション下書きを連動更新',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'Idempotency-Key', in: 'header', schema: { type: 'string' }, description: '応答消失後の再送用。同じ版・同じ内容の再送は保存済みを返す（M956）。省略可' },
      ],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['lineAccountId', 'expectedVersion'], properties: { lineAccountId: { type: 'string' }, expectedVersion: { type: 'integer', minimum: 1 }, automationId: { type: ['string', 'null'] }, automationDraftVersion: { type: ['string', 'null'] }, actions: { type: 'array' }, applyToExisting: { type: 'boolean', default: false }, previewToken: { type: 'string', description: 'applyToExisting の実行に必須。POST /api/tags/{id}/retroactive-preview が返す引き換え券（N-047）' } } } } } },
      responses: { '200': { description: 'Updated' }, '404': { description: 'Not found in account scope' }, '409': { description: 'Tag or action draft version conflict / stale retroactive preview' }, '422': { description: 'Retroactive preview token required' } },
    },
    delete: {
      tags: ['Tags'],
      summary: 'タグ削除',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'Tag deleted' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Tag not found' },
        '409': { description: 'Tag is referenced by active settings' },
      },
    },
  },
  '/api/tags/{id}/delete-impact': {
    get: {
      tags: ['Tags'],
      summary: 'タグ削除前の影響確認',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': {
          description: '友だちへの付与人数と運用設定の参照件数',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                  success: { type: 'boolean', const: true },
                  data: { $ref: '#/components/schemas/TagDeleteImpact' },
                },
              },
            },
          },
        },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Tag not found' },
      },
    },
  },
  '/api/tags/{id}/dependencies': {
    get: {
      tags: ['Tags'],
      summary: 'タグの参照先・連動・待機実行・マイル影響を確認',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Tag dependency impact', content: { 'application/json': { schema: { $ref: '#/components/schemas/TagDependencyImpact' } } } },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Not found in account scope' },
      },
    },
  },
  '/api/tags/{id}/retroactive-preview': {
    post: {
      tags: ['Tags'],
      summary: '既存友だちへの遡及マイルの対象を事前計算（N-047）',
      description:
        'applyToExisting の実行前に、対象人数・付与済み除外・紹介者対象・合計マイルをサーバー側で数える。返す previewToken を PATCH /api/tags/{id} または /api/tags/{id}/mileage の遡及実行へそのまま渡す。実行時に同じ計算をやり直し、一致しない・期限切れの token は止める。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                lineAccountId: { type: 'string' },
                mileage: {
                  type: 'object',
                  properties: {
                    self: { type: 'integer', minimum: 0 },
                    referrer: { type: 'integer', minimum: 0 },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: '遡及対象の事前計算と previewToken',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                  success: { type: 'boolean', const: true },
                  data: {
                    type: 'object',
                    properties: {
                      tagId: { type: 'string' },
                      lineAccountId: { type: ['string', 'null'] },
                      friendCount: { type: 'integer' },
                      selfTargets: { type: 'integer' },
                      selfExcluded: { type: 'integer' },
                      referralTargets: { type: 'integer' },
                      referralExcluded: { type: 'integer' },
                      selfMiles: { type: 'integer' },
                      referralMiles: { type: 'integer' },
                      totalMiles: { type: 'integer' },
                      expiresAt: { type: 'string', format: 'date-time' },
                      previewToken: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Not found in account scope' },
        '422': { description: 'Invalid mileage values' },
      },
    },
  },
};
