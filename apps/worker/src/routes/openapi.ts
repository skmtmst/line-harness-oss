import { Hono } from 'hono';
import type { Env } from '../index.js';

const openapi = new Hono<Env>();

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'LINE OSS CRM API',
    version: '0.24.0',
    description: 'Open-source LINE Official Account CRM/marketing automation API. API-first design for Claude Code / AI agent integration.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'Current server' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API Key passed as Bearer token',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {},
          error: { type: 'string' },
        },
      },
      Friend: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          lineUserId: { type: 'string' },
          displayName: { type: 'string', nullable: true },
          pictureUrl: { type: 'string', nullable: true },
          statusMessage: { type: 'string', nullable: true },
          isFollowing: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
        },
      },
      Tag: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          color: { type: 'string' },
          lineAccountId: { type: 'string' },
          description: { type: ['string', 'null'] },
          manualAssignmentAllowed: { type: 'boolean' },
          reapplyPolicy: { type: 'string', enum: ['first_only', 'every_time'] },
          linkedEnabled: { type: 'boolean' },
          status: { type: 'string', enum: ['active', 'archived'] },
          version: { type: 'integer', minimum: 1 },
          updatedAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          cleanupReasons: {
            type: 'array',
            items: { type: 'string', enum: ['unused', 'duplicate_name'] },
            description: 'withCounts=1 のときに返す整理候補の理由',
          },
        },
      },
      TagDeleteImpact: {
        type: 'object',
        required: ['tag', 'friendCount', 'references', 'blockingReferenceCount', 'canDelete'],
        properties: {
          tag: {
            type: 'object',
            required: ['id', 'name'],
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
          friendCount: { type: 'integer', minimum: 0 },
          references: {
            type: 'object',
            additionalProperties: false,
            required: [
              'broadcasts', 'forms', 'scenarios', 'autoReplies', 'savedSearches',
              'automations', 'commonActions', 'richMenus', 'templates', 'webinars',
              'reminders', 'entryRoutes', 'trackedLinks', 'bookingMenus',
              'affiliateOffers', 'events', 'analyticsFunnels', 'friendAddSettings',
            ],
            properties: Object.fromEntries([
              'broadcasts', 'forms', 'scenarios', 'autoReplies', 'savedSearches',
              'automations', 'commonActions', 'richMenus', 'templates', 'webinars',
              'reminders', 'entryRoutes', 'trackedLinks', 'bookingMenus',
              'affiliateOffers', 'events', 'analyticsFunnels', 'friendAddSettings',
            ].map((key) => [key, { type: 'integer', minimum: 0 }])),
          },
          blockingReferenceCount: { type: 'integer', minimum: 0 },
          canDelete: { type: 'boolean' },
        },
      },
      TagDependencyImpact: {
        type: 'object',
        required: [
          'tag', 'friendCount', 'references', 'linkedActions', 'pendingRunCount',
          'mileageImpact', 'canArchive', 'canDelete', 'checkedAt', 'revision',
        ],
        properties: {
          tag: {
            type: 'object',
            required: ['id', 'name', 'version', 'status'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              version: { type: 'integer', minimum: 1 },
              status: { type: 'string', enum: ['active', 'archived'] },
            },
          },
          friendCount: { type: 'integer', minimum: 0 },
          references: {
            type: 'array',
            items: {
              type: 'object',
              required: ['kind', 'name', 'href', 'state', 'count'],
              properties: {
                kind: { type: 'string' },
                name: { type: 'string' },
                href: { type: 'string' },
                state: { type: 'string' },
                count: { type: 'integer', minimum: 1 },
                definitionVersion: { type: ['integer', 'null'] },
              },
            },
          },
          linkedActions: { type: 'array', items: { type: 'object' } },
          pendingRunCount: { type: 'integer', minimum: 0 },
          mileageImpact: { type: 'object' },
          canArchive: { type: 'boolean' },
          canDelete: { type: 'boolean' },
          checkedAt: { type: 'string', format: 'date-time' },
          revision: { type: 'string' },
        },
      },
      TagCsvImportRow: {
        type: 'object',
        required: ['line', 'name', 'folderName', 'status'],
        properties: {
          line: { type: 'integer', minimum: 1 },
          name: { type: 'string' },
          folderName: { type: 'string' },
          status: {
            type: 'string',
            enum: ['ready', 'created', 'skipped', 'invalid', 'failed'],
          },
          code: {
            type: 'string',
            enum: [
              'name_required', 'name_too_long', 'invalid_character', 'already_exists', 'duplicate_in_file',
              'folder_not_found', 'folder_ambiguous', 'folder_changed', 'create_failed',
            ],
          },
          message: { type: 'string' },
          tagId: { type: 'string' },
        },
      },
      TagCsvImportData: {
        type: 'object',
        required: ['summary', 'rows'],
        properties: {
          outcome: { type: 'string', enum: ['success', 'partial', 'failed'] },
          summary: {
            type: 'object',
            required: ['total', 'ready', 'created', 'skipped', 'invalid', 'failed'],
            properties: Object.fromEntries(
              ['total', 'ready', 'created', 'skipped', 'invalid', 'failed']
                .map((key) => [key, { type: 'integer', minimum: 0 }]),
            ),
          },
          rows: { type: 'array', items: { $ref: '#/components/schemas/TagCsvImportRow' } },
        },
      },
      Scenario: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          triggerType: { type: 'string', enum: ['friend_add', 'tag_added', 'manual'] },
          triggerTagId: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ScenarioStep: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          scenarioId: { type: 'string' },
          stepOrder: { type: 'integer' },
          delayMinutes: { type: 'integer' },
          messageType: { type: 'string', enum: ['text', 'image', 'flex'] },
          messageContent: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Broadcast: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          messageType: { type: 'string', enum: ['text', 'image', 'flex'] },
          messageContent: { type: 'string' },
          targetType: { type: 'string', enum: ['all', 'tag', 'segment', 'multi-account-dedup'] },
          targetTagId: { type: 'string', nullable: true },
          accountIds: { type: 'array', items: { type: 'string' }, nullable: true },
          dedupPriority: { type: 'array', items: { type: 'string' }, nullable: true },
          failedAccountIds: { type: 'array', items: { type: 'string' }, nullable: true },
          status: { type: 'string', enum: ['draft', 'scheduled', 'sending', 'sent'] },
          scheduledAt: { type: 'string', nullable: true },
          sentAt: { type: 'string', nullable: true },
          totalCount: { type: 'integer' },
          successCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          externalId: { type: 'string', nullable: true },
          displayName: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LineAccount: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          channelId: { type: 'string' },
          name: { type: 'string' },
          isActive: { type: 'boolean' },
          country: { type: 'string', nullable: true },
          role: { type: 'string', nullable: true },
          displayOrder: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ConversionPoint: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          eventType: { type: 'string' },
          value: { type: 'number', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ConversionEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          conversionPointId: { type: 'string' },
          friendId: { type: 'string' },
          userId: { type: 'string', nullable: true },
          affiliateCode: { type: 'string', nullable: true },
          metadata: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Affiliate: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenantId: { type: 'string', format: 'uuid' },
          lineAccountId: { type: 'string', nullable: true },
          name: { type: 'string' },
          code: { type: 'string' },
          commissionRate: { type: 'number' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AffiliateReport: {
        type: 'object',
        properties: {
          affiliateId: { type: 'string' },
          affiliateName: { type: 'string' },
          code: { type: 'string' },
          commissionRate: { type: 'number' },
          totalClicks: { type: 'integer' },
          totalConversions: { type: 'integer' },
          totalRevenue: { type: 'number' },
        },
      },
    },
  },
  paths: {
    // ── Friends ─────────────────────────────────────────────────────────────
    '/api/friends': {
      get: {
        tags: ['Friends'],
        summary: '友だち一覧取得',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'tagId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Paginated friends list' } },
      },
    },
    '/api/friends/count': {
      get: { tags: ['Friends'], summary: '友だち数取得', responses: { '200': { description: 'Count' } } },
    },
    '/api/friends/{id}': {
      get: {
        tags: ['Friends'],
        summary: '友だち詳細取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Friend with tags' }, '404': { description: 'Not found' } },
      },
    },
    '/api/friends/{id}/tags': {
      post: {
        tags: ['Friends'],
        summary: '友だちにタグ追加',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { tagId: { type: 'string' } }, required: ['tagId'] } } } },
        responses: { '201': { description: 'Tag added' } },
      },
    },
    '/api/friends/{id}/tags/{tagId}': {
      delete: {
        tags: ['Friends'],
        summary: '友だちからタグ削除',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'tagId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Tag removed' } },
      },
    },
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
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['lineAccountId', 'expectedVersion'], properties: { lineAccountId: { type: 'string' }, expectedVersion: { type: 'integer', minimum: 1 }, automationId: { type: ['string', 'null'] }, automationDraftVersion: { type: ['string', 'null'] }, actions: { type: 'array' }, applyToExisting: { type: 'boolean', default: false } } } } } },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found in account scope' }, '409': { description: 'Tag or action draft version conflict' } },
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
    '/api/media/{id}/download': {
      get: {
        tags: ['Contents'],
        summary: '登録メディアを認証付きでダウンロード',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Media file bytes with Content-Disposition: attachment' },
          '403': { description: 'Staff role required' },
          '404': { description: 'Media not found in account scope' },
        },
      },
    },
    '/api/media/{id}/content': {
      get: {
        tags: ['Contents'],
        summary: '登録メディアの表示用中身を認証付きで取得',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Media file bytes with Content-Disposition: inline' },
          '403': { description: 'Staff role required' },
          '404': { description: 'Media not found in account scope' },
        },
      },
    },
    '/api/common-actions/resources': {
      get: {
        tags: ['Common actions'],
        summary: 'きっかけ別の処理schemaと選択肢を取得',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'trigger', in: 'query', schema: { type: 'string', enum: ['tag.added'] } },
        ],
        responses: { '200': { description: '13 action schemas and scoped resources' }, '422': { description: 'Unsupported trigger' } },
      },
    },
    '/api/friends/{id}/fields': {
      get: {
        tags: ['Friends'], summary: '閲覧可能な友だちの情報欄を取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Friend fields' }, '403': { description: 'Staff role required' }, '404': { description: 'Friend not found in account scope' } },
      },
      put: {
        tags: ['Friends'], summary: '閲覧可能な友だちの情報欄を更新',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Friend fields updated' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Friend not found in account scope' } },
      },
    },
    '/api/reminders': {
      get: {
        tags: ['Reminders'], summary: 'LINEアカウント範囲内のリマインダ一覧を取得',
        parameters: [{ name: 'lineAccountId', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Visible reminders' }, '403': { description: 'Staff role required' }, '404': { description: 'LINE account not found in account scope' } },
      },
    },
    '/api/reminders/{id}/steps/{stepId}': {
      delete: {
        tags: ['Reminders'], summary: '指定したリマインダに属する通を削除',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Reminder step deleted' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Reminder or step not found in account scope' } },
      },
    },
    '/api/friends/{friendId}/reminders': {
      get: {
        tags: ['Reminders'], summary: '閲覧可能な友だちのリマインダ登録を取得',
        parameters: [{ name: 'friendId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Friend reminders' }, '403': { description: 'Staff role required' }, '404': { description: 'Friend not found in account scope' } },
      },
    },
    '/api/auto-replies': {
      get: {
        tags: ['Auto replies'], summary: 'LINEアカウント範囲内の自動応答一覧を取得',
        parameters: [{ name: 'accountId', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Visible auto replies' }, '403': { description: 'Staff role required' }, '404': { description: 'LINE account not found in account scope' } },
      },
    },
    '/api/mileage/rules': {
      get: {
        tags: ['Mileage'], summary: 'LINEアカウント範囲内のマイル付与ルールを取得',
        responses: { '200': { description: 'Visible mileage rules' }, '403': { description: 'Staff role required' } },
      },
      post: {
        tags: ['Mileage'], summary: 'LINEアカウントに属するマイル付与ルールを作成',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lineAccountId', 'name', 'eventType', 'amount'], properties: { lineAccountId: { type: 'string' }, name: { type: 'string' }, eventType: { type: 'string' }, amount: { type: 'integer', minimum: 1 } } } } } },
        responses: { '201': { description: 'Mileage rule created' }, '400': { description: 'LINE account is required' }, '403': { description: 'Owner or admin role or account scope required' } },
      },
    },
    '/api/mileage/rules/{id}': {
      put: {
        tags: ['Mileage'], summary: '所属LINEアカウント内のマイル付与ルールを更新',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Mileage rule updated' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found in account scope' }, '409': { description: 'Legacy global rule is immutable' } },
      },
      delete: {
        tags: ['Mileage'], summary: '所属LINEアカウント内のマイル付与ルールを削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Mileage rule deleted' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found in account scope' }, '409': { description: 'Legacy global rule is immutable' } },
      },
    },
    // ── Scenarios ────────────────────────────────────────────────────────────
    '/api/scenarios': {
      get: {
        tags: ['Scenarios'],
        summary: '閲覧権限とLINEアカウント範囲内のシナリオ一覧取得',
        parameters: [{ name: 'lineAccountId', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Visible scenarios' },
          '403': { description: 'Scenario view permission required' },
          '404': { description: 'LINE account not found in account scope' },
        },
      },
      post: {
        tags: ['Scenarios'],
        summary: 'シナリオ作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, triggerType: { type: 'string' }, description: { type: 'string' }, triggerTagId: { type: 'string' }, isActive: { type: 'boolean' } }, required: ['name', 'triggerType'] } } } },
        responses: { '201': { description: 'Scenario created' } },
      },
    },
    '/api/scenarios/{id}': {
      get: {
        tags: ['Scenarios'],
        summary: 'シナリオ詳細取得 (ステップ含む)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Scenario with steps' },
          '403': { description: 'Scenario view permission required' },
          '404': { description: 'Not found in account scope' },
        },
      },
      put: {
        tags: ['Scenarios'],
        summary: 'シナリオ更新',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Scenarios'],
        summary: 'シナリオ削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/scenarios/{id}/preview': {
      get: {
        tags: ['Scenarios'], summary: 'シナリオの配信時系列を確認',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Timeline preview' }, '403': { description: 'Scenario view permission required' }, '404': { description: 'Not found in account scope' } },
      },
    },
    '/api/scenarios/{id}/stats': {
      get: {
        tags: ['Scenarios'], summary: 'シナリオの到達率を確認',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Scenario statistics' }, '403': { description: 'Scenario view permission required' }, '404': { description: 'Not found in account scope' } },
      },
    },
    '/api/scenarios/{id}/actions': {
      get: {
        tags: ['Scenarios'], summary: 'シナリオのアクションを確認',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Scenario actions' }, '403': { description: 'Scenario view permission required' }, '404': { description: 'Not found in account scope' } },
      },
    },
    '/api/scenarios/{id}/triggers': {
      get: {
        tags: ['Scenarios'], summary: 'シナリオの開始条件を確認',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Scenario triggers' }, '403': { description: 'Scenario view permission required' }, '404': { description: 'Not found in account scope' } },
      },
    },
    '/api/scenarios/{id}/simulate': {
      post: {
        tags: ['Scenarios'],
        summary: '副作用なしで対象人数と通ごとの予定を試算',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['lineAccountId'],
          properties: {
            lineAccountId: { type: 'string' },
            startAt: { type: 'string', format: 'date-time' },
          },
        } } } },
        responses: {
          '200': { description: 'Audience counts and planned steps; no side effects' },
          '403': { description: 'Scenario view permission required' },
          '404': { description: 'Not found in account scope' },
        },
      },
    },
    '/api/scenarios/{id}/runs': {
      get: {
        tags: ['Scenarios'],
        summary: '購読状況・テスト送信・送信枠・通別実績を取得',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'paused', 'completed', 'delivering'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': { description: 'Scenario run summary and metrics' },
          '403': { description: 'Scenario view permission required' },
          '404': { description: 'Not found in account scope' },
        },
      },
    },
    '/api/scenarios/{id}/draft': {
      put: {
        tags: ['Scenarios'],
        summary: '送信後アクション第2期までを楽観ロックで保存',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['lineAccountId', 'expectedVersion', 'afterActions'],
          properties: {
            lineAccountId: { type: 'string' },
            expectedVersion: { type: 'integer', minimum: 0 },
            afterActions: { type: 'array', maxItems: 100, items: { type: 'object' } },
          },
        } } } },
        responses: {
          '200': { description: 'Draft updated with next version' },
          '403': { description: 'scenario.definition.edit permission required' },
          '404': { description: 'Not found in account scope' },
          '409': { description: 'Version conflict' },
          '422': { description: 'Invalid action or foreign account resource' },
        },
      },
    },
    '/api/scenarios/{id}/steps': {
      post: {
        tags: ['Scenarios'],
        summary: 'ステップ追加',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Step created' } },
      },
    },
    '/api/scenarios/{id}/steps/{stepId}': {
      put: {
        tags: ['Scenarios'],
        summary: 'ステップ更新',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Scenarios'],
        summary: 'ステップ削除',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/scenarios/{id}/enroll/{friendId}': {
      post: {
        tags: ['Scenarios'],
        summary: '手動エンロール',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'friendId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '201': { description: 'Enrolled' },
          '404': { description: 'シナリオ・友だちなし' },
          '409': { description: '登録済み・削除不可の連携あり' },
          '422': { description: '未公開・停止中・ブロック中など登録不可' },
        },
      },
    },
    '/api/scenarios/{id}/publish': {
      post: {
        tags: ['Scenarios'],
        summary: '公開版の固定',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: '公開操作の確認キー（8〜200字の英数._:-）。同じキーの再実行は同じ版を返し、別内容での使い回しは409。',
          },
        ],
        responses: {
          '200': { description: 'Published' },
          '400': { description: '確認キー不足・不正' },
          '403': { description: '権限不足' },
          '404': { description: 'シナリオなし・他アカウント' },
          '409': { description: '確認キーの使い回し・同時公開の競合' },
        },
      },
    },
    // ── Broadcasts ───────────────────────────────────────────────────────────
    '/api/broadcasts': {
      get: { tags: ['Broadcasts'], summary: '配信一覧取得', responses: { '200': { description: 'All broadcasts' } } },
      post: {
        tags: ['Broadcasts'],
        summary: '配信作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, messageType: { type: 'string' }, messageContent: { type: 'string' }, targetType: { type: 'string' }, targetTagId: { type: 'string' }, accountIds: { type: 'array', items: { type: 'string' } }, dedupPriority: { type: 'array', items: { type: 'string' } }, scheduledAt: { type: 'string' } }, required: ['title', 'messageType', 'messageContent', 'targetType'] } } } },
        responses: { '201': { description: 'Broadcast created' } },
      },
    },
    '/api/broadcasts/{id}': {
      get: {
        tags: ['Broadcasts'],
        summary: '配信詳細取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Broadcast' } },
      },
      put: { tags: ['Broadcasts'], summary: '配信更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Broadcasts'], summary: '配信削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/broadcasts/{id}/send': {
      post: {
        tags: ['Broadcasts'],
        summary: '即時配信',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Sent' } },
      },
    },
    '/api/broadcasts/dedup-preview': {
      post: {
        tags: ['Broadcasts'],
        summary: '複数アカ重複除外の事前プレビュー',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  accountIds: { type: 'array', items: { type: 'string' } },
                  dedupPriority: { type: 'array', items: { type: 'string' } },
                },
                required: ['accountIds', 'dedupPriority'],
              },
            },
          },
        },
        responses: { '200': { description: 'Preview computed (totalSelected, uniqueRecipients, reduction, perAccount)' } },
      },
    },
    // ── NEN delivery ────────────────────────────────────────────────────────
    '/api/nen-campaigns/metrics/flows': {
      get: {
        tags: ['NEN delivery'],
        summary: 'NEN配信フローの実績を取得',
        description: '開封率は取得できないためnull、関連成果は送信後7日以内の相関として返します。',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
        ],
        responses: { '200': { description: 'Flow metrics' }, '403': { description: 'Account access denied' } },
      },
    },
    '/api/nen-campaigns/metrics/columns': {
      get: {
        tags: ['NEN delivery'],
        summary: 'NENコラムの配信・記事閲覧実績を取得',
        description: '計測台帳がない記事閲覧と、未収集の読了率はnullで返します。',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
        ],
        responses: { '200': { description: 'Column metrics' }, '403': { description: 'Account access denied' } },
      },
    },
    '/api/nen-campaigns/metrics/pets': {
      get: {
        tags: ['NEN delivery'],
        summary: 'ペット登録・誕生日クーポン実績を取得',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
        ],
        responses: { '200': { description: 'Pet and birthday coupon metrics' }, '403': { description: 'Account access denied' } },
      },
    },
    '/api/nen-campaigns/deliveries': {
      get: {
        tags: ['NEN delivery'],
        summary: 'NEN配信履歴を取得',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'processing', 'sent', 'skipped', 'failed', 'cancelled'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: { '200': { description: 'Scoped delivery history' }, '403': { description: 'Account access denied' } },
      },
    },
    '/api/nen-campaigns/deliveries/{id}': {
      get: {
        tags: ['NEN delivery'],
        summary: 'NEN配信履歴の安全な詳細を取得',
        description: '注文情報やクーポンコードを含むraw payloadは返しません。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Delivery detail' }, '404': { description: 'Not found in account scope' } },
      },
    },
    '/api/nen-campaigns/deliveries/{id}/retry': {
      post: {
        tags: ['NEN delivery'],
        summary: '恒久失敗したNEN配信を手動再送',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['lineAccountId', 'expectedVersion', 'reason'],
          properties: {
            lineAccountId: { type: 'string' },
            expectedVersion: { type: 'integer', minimum: 1 },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
          },
        } } } },
        responses: {
          '200': { description: 'Retry queued with a new idempotency generation' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Not found in account scope' },
          '409': { description: 'Retry unavailable or version conflict' },
        },
      },
    },
    // ── Users (UUID Cross-Account) ──────────────────────────────────────────
    '/api/users': {
      get: { tags: ['Users'], summary: '内部ユーザー一覧取得', responses: { '200': { description: 'All users' } } },
      post: {
        tags: ['Users'],
        summary: '内部ユーザー作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, phone: { type: 'string' }, externalId: { type: 'string' }, displayName: { type: 'string' } } } } } },
        responses: { '201': { description: 'User created' } },
      },
    },
    '/api/users/match': {
      post: {
        tags: ['Users'],
        summary: 'メール/電話でユーザー検索',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, phone: { type: 'string' } } } } } },
        responses: { '200': { description: 'Matched user' }, '404': { description: 'Not found' } },
      },
    },
    '/api/users/{id}': {
      get: { tags: ['Users'], summary: 'ユーザー詳細取得', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'User' } } },
      put: { tags: ['Users'], summary: 'ユーザー更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Users'], summary: 'ユーザー削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/users/{id}/link': {
      post: {
        tags: ['Users'],
        summary: '友だちをUUIDにリンク',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { friendId: { type: 'string' } }, required: ['friendId'] } } } },
        responses: { '200': { description: 'Linked' } },
      },
    },
    '/api/users/{id}/accounts': {
      get: {
        tags: ['Users'],
        summary: 'UUID紐付き友だち一覧',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Linked friends/accounts' } },
      },
    },
    // ── LINE Accounts ───────────────────────────────────────────────────────
    '/api/line-accounts': {
      get: { tags: ['LINE Accounts'], summary: 'LINEアカウント一覧', responses: { '200': { description: 'All LINE accounts' } } },
      post: {
        tags: ['LINE Accounts'],
        summary: 'LINEアカウント登録',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { channelId: { type: 'string' }, name: { type: 'string' }, channelAccessToken: { type: 'string' }, channelSecret: { type: 'string' } }, required: ['channelId', 'name', 'channelAccessToken', 'channelSecret'] } } } },
        responses: { '201': { description: 'Account created' } },
      },
    },
    '/api/line-accounts/order': {
      patch: {
        tags: ['LINE Accounts'],
        summary: 'アカウント表示順を一括更新 (drag-drop reorder)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ordered: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        displayOrder: { type: 'integer' },
                      },
                      required: ['id', 'displayOrder'],
                    },
                  },
                },
                required: ['ordered'],
              },
            },
          },
        },
        responses: { '200': { description: 'Order updated' } },
      },
    },
    '/api/line-accounts/{id}': {
      get: { tags: ['LINE Accounts'], summary: 'LINEアカウント詳細', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Account' } } },
      patch: {
        tags: ['LINE Accounts'],
        summary: 'LINEアカウント部分更新',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  isActive: { type: 'boolean' },
                  country: { type: 'string', nullable: true },
                  role: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      put: { tags: ['LINE Accounts'], summary: 'LINEアカウント更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['LINE Accounts'], summary: 'LINEアカウント削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/accounts/health-summary': {
      get: {
        tags: ['LINE Accounts'],
        summary: 'アカウントヘルス要約',
        description: 'staff可視範囲のアカウントの最新riskLevelだけを1回で返す。ログ本文は含めない(サイドバーのN+1解消用 #630)。',
        responses: { '200': { description: 'Health summary' } },
      },
    },
    // ── Conversions ─────────────────────────────────────────────────────────
    '/api/conversions/points': {
      get: { tags: ['Conversions'], summary: 'CV ポイント一覧', responses: { '200': { description: 'All conversion points' } } },
      post: {
        tags: ['Conversions'],
        summary: 'CV ポイント作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, eventType: { type: 'string' }, value: { type: 'number' } }, required: ['name', 'eventType'] } } } },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/conversions/points/{id}': {
      delete: {
        tags: ['Conversions'],
        summary: 'CV ポイント削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/conversions/track': {
      post: {
        tags: ['Conversions'],
        summary: 'コンバージョン記録',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { conversionPointId: { type: 'string' }, friendId: { type: 'string' }, userId: { type: 'string' }, affiliateCode: { type: 'string' }, metadata: { type: 'object' } }, required: ['conversionPointId', 'friendId'] } } } },
        responses: { '201': { description: 'Tracked' } },
      },
    },
    '/api/conversions/events': {
      get: {
        tags: ['Conversions'],
        summary: 'CV イベント一覧',
        parameters: [
          { name: 'conversionPointId', in: 'query', schema: { type: 'string' } },
          { name: 'friendId', in: 'query', schema: { type: 'string' } },
          { name: 'affiliateCode', in: 'query', schema: { type: 'string' } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Events' } },
      },
    },
    '/api/conversions/report': {
      get: {
        tags: ['Conversions'],
        summary: 'CV レポート',
        parameters: [
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Aggregated report' } },
      },
    },
    // ── Affiliates ──────────────────────────────────────────────────────────
    '/api/affiliates': {
      get: { tags: ['Affiliates'], summary: 'アフィリエイト一覧', responses: { '200': { description: 'All affiliates' } } },
      post: {
        tags: ['Affiliates'],
        summary: 'アフィリエイト作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' }, commissionRate: { type: 'number' } }, required: ['name', 'code'] } } } },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/affiliates/{id}': {
      get: { tags: ['Affiliates'], summary: 'アフィリエイト詳細', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Affiliate' } } },
      put: { tags: ['Affiliates'], summary: 'アフィリエイト更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Affiliates'], summary: 'アフィリエイト削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/affiliates/{id}/report': {
      get: {
        tags: ['Affiliates'],
        summary: 'アフィリエイトレポート',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Report' } },
      },
    },
    '/api/affiliates/click': {
      post: {
        tags: ['Affiliates'],
        summary: 'クリック記録',
        description: '紹介コードからの公開クリック記録。認証なしで呼べる。',
        security: [],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' }, url: { type: 'string' } }, required: ['code'] } } } },
        responses: { '201': { description: 'Recorded' } },
      },
    },
    // ── Settings ─────────────────────────────────────────────────────────────
    '/api/settings/features/impact': {
      post: {
        tags: ['Settings'],
        summary: '機能設定の変更案が止める仕事を確認',
        description: '有効から無効へ変わる機能ごとに、公開中・予約中・依存機能の件数と対象種別、対象行IDを返す。保存はしない。止まる仕事があるときだけ確認トークンを発行する。',
        parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['features'], properties: { features: { type: 'object', additionalProperties: { type: 'boolean' } }, expectedVersion: { type: 'integer', minimum: 0 } } } } } },
        responses: { '200': { description: 'Feature impacts with target ids and confirmation token' }, '400': { description: 'Unknown feature or invalid value' }, '403': { description: 'Staff role required' }, '409': { description: 'Version conflict, reread required' } },
      },
    },
    // ── Webhook ─────────────────────────────────────────────────────────────
    '/webhook': {
      post: {
        tags: ['Webhook'],
        summary: 'LINE Messaging API Webhook',
        description: 'LINE プラットフォームからのWebhookイベントを受信。署名検証あり、常に200を返す。',
        security: [],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  tags: [
    { name: 'Friends', description: '友だち管理' },
    { name: 'Tags', description: 'タグ管理' },
    { name: 'Scenarios', description: 'ステップ配信シナリオ' },
    { name: 'Broadcasts', description: '一斉配信' },
    { name: 'NEN delivery', description: 'NEN専用配信・コラム・ペット実績' },
    { name: 'Users', description: 'UUID Cross-Account ユーザー管理' },
    { name: 'LINE Accounts', description: 'マルチLINEアカウント管理' },
    { name: 'Conversions', description: 'コンバージョン計測' },
    { name: 'Affiliates', description: 'アフィリエイト管理' },
    { name: 'Settings', description: '機能設定' },
    { name: 'Webhook', description: 'LINE Webhook' },
  ],
};

// GET /openapi.json - raw spec
openapi.get('/openapi.json', (c) => {
  return c.json(spec);
});

// GET /docs - Swagger UI
openapi.get('/docs', (c) => {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LINE CRM API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;
  return c.html(html);
});

export { openapi };
