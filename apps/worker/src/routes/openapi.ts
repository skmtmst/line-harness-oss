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
      ReminderRegistrant: {
        type: 'object',
        required: [
          'id', 'friendId', 'friendName', 'targetDate', 'status', 'reminderVersionId',
          'sourceKind', 'createdAt', 'updatedAt', 'cancelledAt', 'lockVersion',
        ],
        properties: {
          id: { type: 'string' },
          friendId: { type: 'string' },
          friendName: { type: ['string', 'null'] },
          targetDate: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
          reminderVersionId: { type: ['string', 'null'] },
          sourceKind: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          cancelledAt: { type: ['string', 'null'], format: 'date-time' },
          lockVersion: { type: 'integer', minimum: 0 },
        },
      },
      ReminderRegistrantMutation: {
        type: 'object',
        required: [
          'id', 'friendId', 'targetDate', 'status', 'reminderVersionId', 'lockVersion', 'replayed',
        ],
        properties: {
          id: { type: 'string' },
          friendId: { type: 'string' },
          targetDate: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
          reminderVersionId: { type: ['string', 'null'] },
          lockVersion: { type: 'integer', minimum: 0 },
          replayed: { type: 'boolean' },
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
    // ── Email authentication ───────────────────────────────────────────────
    '/api/auth/register/request': {
      post: {
        tags: ['Auth'], summary: '会員登録用の確認メールを送信', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'turnstileToken', 'agreed'], properties: { email: { type: 'string', format: 'email' }, turnstileToken: { type: 'string' }, agreed: { type: 'boolean' }, deviceMarker: { type: 'string' } } } } } },
        responses: { '200': { description: 'Request accepted without exposing account existence' }, '400': { description: 'Invalid request' }, '429': { description: 'Rate limit exceeded' }, '503': { description: 'Turnstile or mail configuration unavailable' } },
      },
    },
    '/api/auth/register/check': {
      get: {
        tags: ['Auth'], summary: '会員登録トークンを確認', security: [],
        responses: { '200': { description: 'Token state' } },
      },
    },
    '/api/auth/register/complete': {
      post: {
        tags: ['Auth'], summary: '会員登録を完了', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'Tenant and owner account created' }, '400': { description: 'Invalid or expired token' }, '409': { description: 'Account already exists' } },
      },
    },
    '/api/auth/password/login': {
      post: {
        tags: ['Auth'], summary: 'メールアドレスとパスワードでログイン', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } } } } },
        responses: { '200': { description: 'Session issued' }, '401': { description: 'Invalid credentials' }, '429': { description: 'Rate limit exceeded' } },
      },
    },
    '/api/auth/password/forgot': {
      post: {
        tags: ['Auth'], summary: 'パスワード再設定メールを送信', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'turnstileToken'], properties: { email: { type: 'string', format: 'email' }, turnstileToken: { type: 'string' } } } } } },
        responses: { '200': { description: 'Request accepted without exposing account existence' }, '429': { description: 'Rate limit exceeded' }, '503': { description: 'Turnstile or mail configuration unavailable' } },
      },
    },
    '/api/auth/password/reset/check': {
      get: {
        tags: ['Auth'], summary: 'パスワード再設定トークンを確認', security: [],
        responses: { '200': { description: 'Token state' } },
      },
    },
    '/api/auth/password/reset': {
      post: {
        tags: ['Auth'], summary: 'パスワードを再設定', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'Password updated and session issued' }, '400': { description: 'Invalid or expired token' } },
      },
    },
    '/api/auth/two-factor/setup': {
      post: {
        tags: ['Auth'], summary: 'TOTP未登録の管理者向けに二段階認証の初回設定を開始', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['challengeToken'], properties: { challengeToken: { type: 'string' } } } } } },
        responses: { '200': { description: 'provisioningUri and manualKey issued' }, '400': { description: 'Missing challenge token' }, '401': { description: 'Invalid or expired setup challenge' }, '409': { description: 'TOTP already configured' } },
      },
    },
    '/api/auth/two-factor/setup/confirm': {
      post: {
        tags: ['Auth'], summary: '二段階認証の初回設定を確認してセッションを発行', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['challengeToken', 'code'], properties: { challengeToken: { type: 'string' }, code: { type: 'string' } } } } } },
        responses: { '200': { description: 'TOTP enabled; session issued' }, '400': { description: 'Invalid code' }, '401': { description: 'Invalid or expired setup challenge' }, '429': { description: 'Attempt limit exceeded' } },
      },
    },
    '/api/auth/ops-invite/check': {
      get: {
        tags: ['Auth'], summary: '運営メンバーの招待を確認（★V6 37-10-A）', security: [],
        parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Invite is valid; email, name, needsPassword' }, '404': { description: 'Unknown invite' }, '410': { description: 'Expired or used' } },
      },
    },
    '/api/auth/ops-invite/accept': {
      post: {
        tags: ['Auth'], summary: '運営メンバーの招待を受ける（名前・パスワード設定 → 2要素認証待ち）', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } } } } } },
        responses: { '200': { description: 'Session issued; next = two-factor-setup' }, '400': { description: 'Invalid name or password' }, '404': { description: 'Unknown invite' }, '410': { description: 'Expired or used' } },
      },
    },
    '/api/auth/sessions': {
      get: {
        tags: ['Auth'], summary: '本人のアクティブなセッション一覧',
        responses: { '200': { description: 'Sessions with current flag, user agent, masked IP' }, '401': { description: 'Not authenticated' } },
      },
    },
    '/api/auth/sessions/{tokenHash}': {
      delete: {
        tags: ['Auth'], summary: '本人のセッションを1件失効（現在のセッションは confirmCurrent=1 が必須）',
        parameters: [{ name: 'tokenHash', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Session revoked' }, '401': { description: 'Not authenticated' }, '404': { description: 'Session not found or not owned' }, '409': { description: 'Current-session confirmation required' } },
      },
    },
    '/api/auth/sessions/revoke-others': {
      post: {
        tags: ['Auth'], summary: '今のセッション以外をまとめて失効',
        responses: { '200': { description: 'Count of revoked sessions' }, '401': { description: 'Not authenticated' } },
      },
    },
    '/api/auth/step-up': {
      post: {
        tags: ['Auth'], summary: '高危険操作用の5分・1回限り再認証grantを発行',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['code', 'purpose'], properties: { code: { type: 'string' }, purpose: { type: 'string', enum: ['operations.control', 'affiliate.payout.export', 'photo.original.download', 'staff.permissions.change', 'staff.two_factor.remove'] } } } } } },
        responses: { '201': { description: 'Step-up grant issued' }, '400': { description: 'Invalid or wrong code' }, '403': { description: 'TOTP not configured' }, '409': { description: 'Code already used' }, '429': { description: 'Attempt limit exceeded' } },
      },
    },
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
        responses: { '200': { description: 'One image generated' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '422': { description: 'Image request rejected' }, '502': { description: 'Image provider failure' } },
      },
    },
    '/api/hq/banners/generations/{id}/cancel': {
      post: {
        tags: ['HQ Banners'], summary: '残りのバナー生成を中止',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Cancelled' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
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
    // ── NEN Members (会員ランク・ライフタイム・マイル ★V6 37-1) ──────────────
    '/api/public/nen/adopted-photos': {
      get: {
        tags: ['NEN Members'],
        summary: '公開許可済みでサイト掲載中の採用写真を取得',
        security: [],
        parameters: [
          {
            name: 'lineAccountId', in: 'query', required: false,
            description: '内部LINEアカウントID。officialAccountBasicIdと両方指定した場合は同じアカウントであることが必要',
            schema: { type: 'string' },
          },
          {
            name: 'officialAccountBasicId', in: 'query', required: false,
            description: 'LINE公式アカウントのBasic ID。前後の空白を除いた完全一致で、有効かつ未アーカイブの一意なアカウントだけを選択',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Public photos for the selected LINE account' },
          '400': { description: 'Selector missing or selectors do not match' },
          '404': { description: 'No unique active LINE account matches the Basic ID' },
        },
      },
    },
    '/api/nen/rank-settings': {
      get: {
        tags: ['NEN Members'], summary: '会員ランク設定（ランク・決まり方・ライフタイムの節目・数値）を取得',
        parameters: [{ name: 'accountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Rank settings, rules, lifetime milestones and KPIs' }, '400': { description: 'accountId is required' }, '403': { description: 'Account not visible' } },
      },
      put: {
        tags: ['NEN Members'], summary: 'ランク（名前・通年のしきい値・マイル還元）を一括保存し、ECへ同期してタグを付け替える',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'ranks'], properties: { accountId: { type: 'string' }, ranks: { type: 'array', maxItems: 8, items: { type: 'object', required: ['name', 'annualThresholdYen', 'mileRatePercent'], properties: { id: { type: 'string', nullable: true }, name: { type: 'string', maxLength: 20 }, annualThresholdYen: { type: 'integer', minimum: 0 }, mileRatePercent: { type: 'number', minimum: 0, maximum: 10 } } } } } } } } },
        responses: { '200': { description: 'Saved settings with sync result' }, '400': { description: 'Validation failed' }, '403': { description: 'Owner or admin role required' } },
      },
    },
    '/api/nen/rank-settings/resync': {
      post: {
        tags: ['NEN Members'], summary: 'ランク設定をECへ送り直す',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId'], properties: { accountId: { type: 'string' } } } } } },
        responses: { '200': { description: 'Settings with sync result' }, '403': { description: 'Owner or admin role required' } },
      },
    },
    '/api/nen/lifetime-milestones': {
      put: {
        tags: ['NEN Members'], summary: 'ライフタイム（累計購入額）の節目を一括保存し、ECへ同期',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'milestones'], properties: { accountId: { type: 'string' }, milestones: { type: 'array', maxItems: 12, items: { type: 'object', required: ['thresholdYen', 'title'], properties: { id: { type: 'string', nullable: true }, thresholdYen: { type: 'integer', minimum: 1 }, title: { type: 'string', maxLength: 30 }, notifyOnReach: { type: 'boolean' } } } } } } } } },
        responses: { '200': { description: 'Saved milestones with sync result' }, '400': { description: 'Validation failed' }, '403': { description: 'Owner or admin role required' } },
      },
    },
    '/api/nen/members': {
      get: {
        tags: ['NEN Members'], summary: '会員一覧（ランク・通年・ライフタイム・マイル残高・ペット）を取得',
        parameters: [
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'rank', in: 'query', schema: { type: 'string' } },
          { name: 'pet', in: 'query', schema: { type: 'string', enum: ['any', 'with', 'without'] } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['annual_desc', 'lifetime_desc', 'balance_desc', 'recent'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: { '200': { description: 'Paged members with KPIs and rank definitions' }, '400': { description: 'accountId is required' }, '403': { description: 'Account not visible' } },
      },
    },
    '/api/nen/feeding-products': {
      get: {
        tags: ['NEN Members'], summary: '主食のカロリー表（マイペットの「今日の目安」に使う）と係数表を取得',
        parameters: [{ name: 'accountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Feeding products, pet count and energy factors' }, '400': { description: 'accountId is required' }, '403': { description: 'Account not visible' } },
      },
      put: {
        tags: ['NEN Members'], summary: '主食のカロリー表を一括保存し、登録済みペットの目安を計算し直す',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'products'], properties: { accountId: { type: 'string' }, treatLimitPercent: { type: 'integer', minimum: 1, maximum: 30, description: 'おやつの上限（1日の必要カロリーに対する %）。省略時は現在値（既定 10）' }, products: { type: 'array', maxItems: 20, items: { type: 'object', required: ['name', 'kcalPer100g'], properties: { id: { type: 'string', nullable: true }, name: { type: 'string', maxLength: 40 }, kcalPer100g: { type: 'number', minimum: 1, maximum: 1000 }, isDefault: { type: 'boolean' }, kind: { type: 'string', enum: ['staple', 'nen'], description: 'staple＝主食、nen＝然の商品（おやつ）' } } } } } } } } },
        responses: { '200': { description: 'Saved products' }, '400': { description: 'Validation failed' }, '403': { description: 'Owner or admin role required' } },
      },
    },
    // ── NEN Pets / Health（★V6 37-3／37-4） ──────────────────────────────
    '/api/nen/pets': {
      get: {
        tags: ['NEN Members'], summary: 'マイペット一覧（今日の目安・避妊去勢・運動量・主食・体重の更新）と数値を取得',
        parameters: [
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'species', in: 'query', schema: { type: 'string', enum: ['dog', 'cat'] } },
          { name: 'product', in: 'query', schema: { type: 'string' } },
          { name: 'weight', in: 'query', schema: { type: 'string', enum: ['stale', 'fresh'] } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['updated_desc', 'name', 'weight_desc', 'age_desc'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: { '200': { description: 'Paged pets with KPIs' }, '400': { description: 'accountId is required' }, '403': { description: 'Account not visible' } },
      },
    },
    '/api/nen/health': {
      get: {
        tags: ['NEN Members'], summary: '健康日記の一覧（最終記録・30日の記録数・8週の体重推移・気になる変化）と数値を取得',
        parameters: [
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'change', in: 'query', schema: { type: 'string', enum: ['concern', 'silent', 'none'] } },
          { name: 'last', in: 'query', schema: { type: 'string', enum: ['7', '30', 'over30'] } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['concern', 'recent', 'records_desc'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: { '200': { description: 'Paged pets with health summaries and KPIs' }, '400': { description: 'accountId is required' }, '403': { description: 'Account not visible' } },
      },
    },
    '/api/nen/health/{petId}/summary': {
      get: {
        tags: ['NEN Members'], summary: '診察時に獣医師へ見せる「30日のまとめ」（記録・集計。医療判断はしない）',
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: '30-day summary' }, '403': { description: 'Account not visible' }, '404': { description: 'Pet not found' } },
      },
    },
    // ── LIFF：然のマイページ（★V6 37-2） ──────────────────────────────────
    '/api/liff/nen/pets/{id}': {
      put: {
        tags: ['NEN Members'], summary: 'マイペットの変更（体重・避妊去勢・運動量・主食）。保存すると「今日の目安」を計算し直す',
        security: [],
        description: 'LIFF の ID トークンで本人確認する（Authorization: Bearer）。本人のペットだけ変えられる。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', maxLength: 80 }, breed: { type: 'string', maxLength: 80 }, gender: { type: 'string', enum: ['male', 'female', 'unknown'] }, birthday: { type: 'string', format: 'date' }, weightKg: { type: 'number', minimum: 0.2, maximum: 150 }, concerns: { type: 'array', maxItems: 10, items: { type: 'string' } }, neutered: { type: 'string', enum: ['yes', 'no', 'unknown'] }, activityLevel: { type: 'string', enum: ['low', 'normal', 'high'] }, feedingProductId: { type: 'string', nullable: true } } } } } },
        responses: { '200': { description: 'Updated pet with feeding plan' }, '400': { description: 'Validation failed' }, '401': { description: 'LIFF identity required' }, '404': { description: 'Pet not found' } },
      },
    },
    '/api/liff/nen/health-logs/summary': {
      get: {
        tags: ['NEN Members'], summary: '健康日記「獣医師に見せる（直近30日のまとめ）」（★V6 37-2-B）。管理画面の 30日のまとめ と同じ計算',
        security: [],
        description: 'LIFF の ID トークンで本人確認する（Authorization: Bearer）。本人のペットだけ。医療判断は含めない。',
        parameters: [{ name: 'petId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '30-day summary (records, weight, heart/respiratory averages, stool/appetite/skin/tear counts, notes, logs)' }, '401': { description: 'LIFF identity required' }, '404': { description: 'Pet not found' } },
      },
    },
    // ── HQ Billing ─────────────────────────────────────────────────────────
    '/api/hq/billing/summary': {
      get: {
        tags: ['HQ Billing'], summary: '統括の契約状態と選択可能なプランを取得',
        responses: { '200': { description: 'Tenant billing summary and plan entitlements' }, '404': { description: 'Tenant not found' } },
      },
    },
    '/api/hq/billing/checkout': {
      post: {
        tags: ['HQ Billing'], summary: 'Stripe Checkoutの申込URLを作成',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['planKey'], properties: { planKey: { type: 'string', enum: ['light', 'standard', 'pro'] } } } } } },
        responses: { '200': { description: 'Checkout URL' }, '400': { description: 'Invalid plan' }, '403': { description: 'Owner role required' }, '409': { description: 'Already subscribed or billing exempt' }, '503': { description: 'Stripe or price configuration unavailable' } },
      },
    },
    '/api/hq/billing/portal': {
      post: {
        tags: ['HQ Billing'], summary: 'StripeカスタマーポータルURLを作成',
        responses: { '200': { description: 'Customer portal URL' }, '403': { description: 'Owner or admin role required' }, '409': { description: 'No active customer' }, '503': { description: 'Admin origin unavailable' } },
      },
    },
    '/api/hq/billing/invoices': {
      get: {
        tags: ['HQ Billing'], summary: '統括の支払い履歴を取得',
        responses: { '200': { description: 'Up to 12 tenant-scoped invoices' }, '403': { description: 'Owner or admin role required' }, '502': { description: 'Stripe API unavailable' } },
      },
    },
    '/api/hq/billing/webhook': {
      post: {
        tags: ['HQ Billing'], summary: 'Stripe課金イベントを受信', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'Event accepted idempotently' }, '400': { description: 'Invalid signature or payload' }, '413': { description: 'Payload too large' }, '503': { description: 'Webhook secret is not configured' } },
      },
    },
    // ── HQ Support ─────────────────────────────────────────────────────────
    '/api/hq/support/kinds': {
      get: {
        tags: ['HQ Support'], summary: '問い合わせ種別を取得',
        responses: { '200': { description: 'Supported inquiry kinds' } },
      },
    },
    '/api/hq/support/requests': {
      get: {
        tags: ['HQ Support'], summary: '統括の問い合わせ履歴を取得',
        responses: { '200': { description: 'Tenant-scoped support requests' } },
      },
      post: {
        tags: ['HQ Support'], summary: '運営への問い合わせを登録',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['kind', 'subject', 'body'], properties: { kind: { type: 'string' }, subject: { type: 'string', maxLength: 100 }, body: { type: 'string', maxLength: 4000 }, lineAccountId: { type: 'string' }, attachments: { type: 'array', maxItems: 3, items: { type: 'object' } } } } } } },
        responses: { '201': { description: 'Recorded; notification result is included' }, '400': { description: 'Invalid request' }, '403': { description: 'Read-only staff cannot submit' }, '404': { description: 'Line account not found in tenant scope' } },
      },
    },
    // ── Ops Console（★V6 37 運営コンソール）─────────────────────────────
    '/api/hq/support/requests/{id}': {
      get: { tags: ['HQ Support'], summary: 'お問い合わせ 1 件のやり取り（★V6 36-3-A）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Request with messages' }, '404': { description: 'Not found' } } },
    },
    '/api/hq/support/requests/{id}/messages': {
      post: { tags: ['HQ Support'], summary: 'お問い合わせの続きを送る（運営へ通知・控えを送信）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string' }, attachments: { type: 'array', items: { type: 'object' } } } } } } }, responses: { '201': { description: 'Message added' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' }, '413': { description: 'Attachment too large' } } },
    },
    '/api/ops/me': {
      get: { tags: ['Ops Console'], summary: 'ログイン中の運営マスター', responses: { '200': { description: 'Platform admin identity and active impersonation' }, '403': { description: 'Not a platform admin' } } },
    },
    '/api/ops/tenants': {
      get: { tags: ['Ops Console'], summary: '契約先（統括）の一覧', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'suspended', 'archived'] } }], responses: { '200': { description: 'Tenants with counts and summary' }, '403': { description: 'Not a platform admin' } } },
    },
    '/api/ops/tenants/{id}': {
      get: { tags: ['Ops Console'], summary: '契約先の詳細', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Tenant, accounts, members, recent audit' }, '404': { description: 'Tenant not found' } } },
    },
    '/api/ops/tenants/{id}/status': {
      patch: { tags: ['Ops Console'], summary: '契約先の状態を変更（停止・アーカイブ・再開）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status', 'reason'], properties: { status: { type: 'string', enum: ['active', 'suspended', 'archived'] }, reason: { type: 'string', minLength: 4, maxLength: 500 }, confirmName: { type: 'string' } } } } } }, responses: { '200': { description: 'Status changed; audit recorded (visible to tenant)' }, '400': { description: 'Missing reason or name confirmation' }, '403': { description: 'Read-only or not a platform admin' } } },
    },
    '/api/ops/impersonation/current': {
      get: { tags: ['Ops Console'], summary: '有効な代理ログイン', responses: { '200': { description: 'Active impersonation or null' } } },
    },
    '/api/ops/impersonation/start': {
      post: { tags: ['Ops Console'], summary: '代理ログインを開始（既定は閲覧のみ）', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tenantId'], properties: { tenantId: { type: 'string' } } } } } }, responses: { '200': { description: 'Impersonation started in read mode' }, '400': { description: 'Archived tenant' }, '404': { description: 'Tenant not found' } } },
    },
    '/api/ops/impersonation/write': {
      post: { tags: ['Ops Console'], summary: '書き込みに切り替える（理由必須）', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 4, maxLength: 500 } } } } } }, responses: { '200': { description: 'Switched to write mode; audit visible to tenant' }, '400': { description: 'Missing reason or not impersonating' } } },
    },
    '/api/ops/impersonation/read': {
      post: { tags: ['Ops Console'], summary: '閲覧のみに戻す', responses: { '200': { description: 'Switched to read mode' }, '400': { description: 'Not impersonating' } } },
    },
    '/api/ops/impersonation/pii-reveal': {
      post: { tags: ['Ops Console'], summary: '個人情報を一時的に表示（理由必須）', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 4, maxLength: 500 } } } } } }, responses: { '200': { description: 'PII revealed for this impersonation; logged' }, '400': { description: 'Missing reason or not impersonating' } } },
    },
    '/api/ops/impersonation/end': {
      post: { tags: ['Ops Console'], summary: '代理ログインを終える', responses: { '200': { description: 'Ended (or nothing active)' } } },
    },
    '/api/ops/audit': {
      get: { tags: ['Ops Console'], summary: '運営の操作記録', parameters: [{ name: 'tenant_id', in: 'query', schema: { type: 'string' } }, { name: 'action', in: 'query', schema: { type: 'string' } }, { name: 'from', in: 'query', schema: { type: 'string' } }, { name: 'to', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Audit rows and total' } } },
    },
    '/api/ops/members': {
      get: { tags: ['Ops Console'], summary: '運営メンバーの一覧', responses: { '200': { description: 'Platform admins and monthly summary' } } },
      post: { tags: ['Ops Console'], summary: '既存の権限者を運営メンバーに加える', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { staffId: { type: 'string' }, email: { type: 'string' } } } } } }, responses: { '201': { description: 'Added; approved by the caller' }, '400': { description: 'Cannot add yourself' }, '404': { description: 'Staff not found' } } },
    },
    '/api/ops/members/{staffId}/resend-invite': {
      post: { tags: ['Ops Console'], summary: '招待メールを送り直す（招待中・2要素認証待ちの人だけ）', parameters: [{ name: 'staffId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Resent' }, '400': { description: 'Already active' }, '404': { description: 'Invite not found' } } },
    },
    '/api/ops/members/{staffId}': {
      patch: { tags: ['Ops Console'], summary: '運営メンバーの停止・再開', parameters: [{ name: 'staffId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['isActive'], properties: { isActive: { type: 'boolean' } } } } } }, responses: { '200': { description: 'Updated' }, '400': { description: 'Self or last member' }, '404': { description: 'Staff not found' } } },
    },
    // ── HQ Notices / Ops Announcements（★V6 37-7） ────────────────────────
    '/api/hq/notices': {
      get: { tags: ['HQ Support'], summary: '運営からの未読のお知らせ（画面のお知らせ）', responses: { '200': { description: 'Unread notices for the caller' } } },
    },
    '/api/hq/notices/{id}/read': {
      post: { tags: ['HQ Support'], summary: 'お知らせを既読にする', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Marked' } } },
    },
    '/api/hq/notices/line-registration': {
      get: { tags: ['HQ Support'], summary: '契約者専用LINEの登録案内（友だち追加 URL と本人の確認コード）', responses: { '200': { description: 'Registration info' } } },
    },
    '/api/ops/notice-line-account': {
      get: { tags: ['Ops Console'], summary: '契約者専用LINEに使うアカウントと候補', responses: { '200': { description: 'Current and candidates' } } },
      put: { tags: ['Ops Console'], summary: '契約者専用LINEに使うアカウントを指定する', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { lineAccountId: { type: 'string', nullable: true } } } } } }, responses: { '200': { description: 'Saved' }, '400': { description: 'Not an ops account' } } },
    },
    '/api/ops/announcements': {
      get: { tags: ['Ops Console'], summary: 'お知らせの一覧（下書き・予約・配信済み）', responses: { '200': { description: 'Announcements' } } },
      post: { tags: ['Ops Console'], summary: 'お知らせを作る（下書き／予約／今すぐ送る）', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['subject', 'body', 'channels'], properties: { subject: { type: 'string' }, body: { type: 'string' }, audienceKind: { type: 'string', enum: ['all', 'plan', 'tenants'] }, audiencePlans: { type: 'array', items: { type: 'string' } }, audienceTenantIds: { type: 'array', items: { type: 'string' } }, channels: { type: 'array', items: { type: 'string', enum: ['line', 'screen', 'email'] } }, publishAt: { type: 'string' }, mode: { type: 'string', enum: ['draft', 'schedule', 'send'] } } } } } }, responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' }, '409': { description: 'Notice LINE account missing' } } },
    },
    '/api/ops/knowledge': {
      get: { tags: ['Ops Console'], summary: '運営専用ナレッジ一覧（検索・種別・承認状態・ページ送り）', responses: { '200': { description: 'Articles and total' }, '403': { description: 'Platform admin required' } } },
    },
    '/api/ops/knowledge/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Ops Console'], summary: 'ナレッジ記事と解決根拠', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Article' }, '404': { description: 'Not found' } } },
      put: { tags: ['Ops Console'], summary: 'ナレッジ記事を編集（承認失効・版照合）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' }, '409': { description: 'Version conflict' } } },
    },
    '/api/ops/knowledge/{id}/review': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: { tags: ['Ops Console'], summary: '根拠確認後の承認・見送り・無効化（版照合）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Reviewed' }, '400': { description: 'Confirmation required' }, '409': { description: 'Source or version changed' } } },
    },
    '/api/ops/knowledge/{id}/feedback': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: { tags: ['Ops Console'], summary: '参照した記事の評価', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Feedback recorded' }, '409': { description: 'Usage not found or changed' } } },
    },
    '/api/ops/knowledge/tickets/{id}/process': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: { tags: ['Ops Console'], summary: '対象の解決済み問い合わせのナレッジ生成予約を実行（運営書込権限必須・二重実行防止）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Current knowledge and job state' }, '403': { description: 'Forbidden' }, '404': { description: 'Ticket not found' }, '503': { description: 'AI unavailable' } } },
    },
    '/api/ops/knowledge/tickets/{id}/retry': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: { tags: ['Ops Console'], summary: '失敗した記事生成の再試行を予約', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '202': { description: 'Queued' }, '409': { description: 'Not retryable' } } },
    },
    '/api/ops/announcements/preview': {
      post: { tags: ['Ops Console'], summary: '宛先の見積もり（契約先数・権限者数・LINE登録済み数）', responses: { '200': { description: 'Audience preview' } } },
    },
    '/api/ops/announcements/{id}': {
      put: { tags: ['Ops Console'], summary: '下書き・予約のお知らせを変える（今すぐ送るも可）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' }, '409': { description: 'Already sent' } } },
      delete: { tags: ['Ops Console'], summary: '下書き・予約のお知らせを消す', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' }, '409': { description: 'Already sent' } } },
    },
    // ── Ops Console: ダッシュボード（★V6 37-2） ────────────────────────────
    '/api/ops/dashboard': {
      get: { tags: ['Ops Console'], summary: '運営ダッシュボード（MRR は定価ベース・契約数・月ごとの売上・要対応・チケット・LINE登録・使用量）', parameters: [
        { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['month', 'prev_month', 'year'] } },
      ], responses: { '200': { description: 'Dashboard aggregates' } } },
    },
    '/api/ops/dashboard/line-unregistered': {
      get: { tags: ['Ops Console'], summary: 'LINE 未登録の権限者（名前と契約先だけ）', responses: { '200': { description: 'Unregistered staff' } } },
    },
    // ── Ops Console: お問い合わせ（★V6 37-6） ────────────────────────────
    '/api/ops/support/summary': {
      get: { tags: ['Ops Console'], summary: 'お問い合わせの状態別件数と数値カード（未対応・初回返信・解決率・解決時間）', responses: { '200': { description: 'Counts by stage and KPIs' } } },
    },
    '/api/ops/support/tickets': {
      get: { tags: ['Ops Console'], summary: 'チケット一覧（状態・優先度・検索・並び替え）', parameters: [
        { name: 'stage', in: 'query', required: false, schema: { type: 'string', enum: ['all', 'new', 'in_progress', 'waiting', 'resolved', 'closed'] } },
        { name: 'priority', in: 'query', required: false, schema: { type: 'string', enum: ['low', 'medium', 'high'] } },
        { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sort', in: 'query', required: false, schema: { type: 'string', enum: ['newest', 'oldest', 'priority'] } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        { name: 'offset', in: 'query', required: false, schema: { type: 'integer' } },
      ], responses: { '200': { description: 'Tickets with total' } } },
      post: { tags: ['Ops Console'], summary: '運営が代わりに起票する', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tenantId', 'subject', 'body'], properties: { tenantId: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, kind: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] }, channel: { type: 'string', enum: ['ops', 'line'] }, staffId: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' }, '404': { description: 'Staff not found' } } },
    },
    '/api/ops/support/tickets/{id}': {
      get: { tags: ['Ops Console'], summary: 'チケットの内容・やり取り・下書き・契約先の状況（閲覧を監査に記録）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Ticket detail' }, '404': { description: 'Not found' } } },
      patch: { tags: ['Ops Console'], summary: '状態・優先度を変える', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { stage: { type: 'string', enum: ['new', 'in_progress', 'waiting', 'resolved', 'closed'] }, priority: { type: 'string', enum: ['low', 'medium', 'high'] } } } } } }, responses: { '200': { description: 'Updated' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' } } },
    },
    '/api/ops/support/tickets/{id}/reply': {
      post: { tags: ['Ops Console'], summary: '返信する（登録メールへ送り、統括の履歴に載せる）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string' }, nextStage: { type: 'string' }, aiAssisted: { type: 'boolean' } } } } } }, responses: { '201': { description: 'Replied' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' }, '409': { description: 'Closed ticket' } } },
    },
    '/api/ops/support/tickets/{id}/draft': {
      put: { tags: ['Ops Console'], summary: '返信の下書きを保存する（空なら削除）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { body: { type: 'string' } } } } } }, responses: { '200': { description: 'Saved' }, '404': { description: 'Not found' } } },
      delete: { tags: ['Ops Console'], summary: '返信の下書きを消す', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } } },
    },
    '/api/ops/support/tickets/{id}/draft/ai': {
      post: { tags: ['Ops Console'], summary: 'AI（Workers AI）で返信の下書きを作る', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'Draft generated' }, '404': { description: 'Not found' }, '502': { description: 'AI failed' }, '503': { description: 'AI not configured' } } },
    },
    '/api/hq/operator-history': {
      get: { tags: ['HQ Support'], summary: '契約先から見える運営の操作履歴（書き込みを伴ったものだけ）', responses: { '200': { description: 'Visible operator actions for the caller tenant' } } },
    },
    // ── HQ Templates ───────────────────────────────────────────────────────
    '/api/hq/templates/media': {
      post: {
        tags: ['HQ Templates'], summary: '統括ひな形のPNG/JPEG画像を登録',
        parameters: [
          { name: 'purpose', in: 'query', required: true, schema: { type: 'string', enum: ['message', 'rich_menu'] } },
          { name: 'filename', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ],
        requestBody: { required: true, content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } },
        responses: { '201': { description: 'Immutable tenant-scoped image receipt; identical retries reuse it' }, '403': { description: 'Tenant-wide owner/admin write permission required' }, '422': { description: 'Invalid image, dimensions, size or unconfirmed upload' } },
      },
    },
    '/api/hq/templates/accounts': {
      get: {
        tags: ['HQ Templates'],
        summary: '配布先として選べるLINE公式アカウントを取得',
        responses: { '200': { description: 'Tenant-scoped account list' }, '403': { description: 'Owner or admin role required' } },
      },
    },
    '/api/hq/templates': {
      get: {
        tags: ['HQ Templates'],
        summary: '統括ひな形一覧を取得',
        parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['tag', 'rich_menu', 'template', 'form'] } }],
        responses: { '200': { description: 'Tenant-scoped template list' }, '400': { description: 'Invalid template type' }, '403': { description: 'Owner or admin role required' } },
      },
      post: {
        tags: ['HQ Templates'],
        summary: '統括ひな形を作成',
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' }, description: '再送時も同じ値を使用する作成依頼ID。省略時はbody.requestIdが必須' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['type', 'name', 'definition'], properties: {
            requestId: { type: 'string' }, type: { type: 'string', enum: ['tag', 'rich_menu', 'template', 'form'] },
            name: { type: 'string', minLength: 1 }, description: { type: 'string' }, definition: { type: 'object' },
          } } } },
        },
        responses: { '201': { description: 'Created, or the same idempotent result' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' }, '409': { description: 'Idempotency conflict' } },
      },
    },
    '/api/hq/templates/{id}': {
      get: {
        tags: ['HQ Templates'], summary: '統括ひな形の詳細を取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Template detail' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['HQ Templates'], summary: '統括ひな形を改訂',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedRevision', 'name', 'definition'], properties: {
          expectedRevision: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1 }, description: { type: 'string' }, definition: { type: 'object' },
        } } } } },
        responses: { '200': { description: 'Updated' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Revision conflict' } },
      },
      delete: {
        tags: ['HQ Templates'], summary: '統括ひな形を削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedRevision'], properties: { expectedRevision: { type: 'integer', minimum: 1 } } } } } },
        responses: { '200': { description: 'Deleted' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Revision conflict' } },
      },
    },
    '/api/hq/templates/{id}/preflight': {
      post: {
        tags: ['HQ Templates'], summary: '配布先の競合を事前検査',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountIds'], properties: { accountIds: { type: 'array', items: { type: 'string' } } } } } } },
        responses: { '200': { description: 'Preflight result with per-account conflicts' }, '400': { description: 'Invalid account selection' }, '403': { description: 'Owner or admin role required' } },
      },
    },
    '/api/hq/templates/{id}/distribute': {
      post: {
        tags: ['HQ Templates'], summary: '事前検査済みの選択内容で店舗へ配布',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['preflightId', 'resolutions'], properties: {
          preflightId: { type: 'string' }, resolutions: { type: 'array', maxItems: 270, items: { type: 'object', required: ['accountId', 'sourceId', 'mode'], properties: {
            accountId: { type: 'string' }, sourceId: { type: 'string' }, mode: { type: 'string', enum: ['create', 'overwrite', 'alias'] }, targetId: { type: 'string' },
          } } },
        } } } } },
        responses: { '200': { description: 'Distribution run result' }, '400': { description: 'Invalid or changed selection' }, '403': { description: 'Owner or admin role required' }, '409': { description: 'Template or target version conflict' } },
      },
    },
    '/api/hq/templates/{id}/distributions/{runId}': {
      get: {
        tags: ['HQ Templates'], summary: '配布実行の結果を取得',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'runId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Distribution result' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' } },
      },
    },
    // ── Analytics ──────────────────────────────────────────────────────────
    '/api/analytics/report-schedules/{id}': {
      put: {
        tags: ['Analytics'], summary: '定期レポートの内容を更新（楽観ロック: expectedUpdatedAt 必須、1回限りの依頼は不可）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedUpdatedAt'], properties: { expectedUpdatedAt: { type: 'string' }, name: { type: 'string' }, cadence: { type: 'string', enum: ['weekly', 'monthly'] }, weekday: { type: 'integer', minimum: 0, maximum: 6 }, monthDay: { type: 'integer', minimum: 1, maximum: 31 }, sendTime: { type: 'string' }, timeZone: { type: 'string' }, channels: { type: 'array', items: { type: 'string' } }, savedAnalysisIds: { type: 'array', items: { type: 'string' } }, recipients: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { '200': { description: 'Updated report schedule' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Updated elsewhere first' }, '422': { description: 'Validation failed' } },
      },
    },
    '/api/analytics/report-schedules/{id}/status': {
      put: {
        tags: ['Analytics'], summary: '定期レポートの停止・再開・しまう（楽観ロック: expectedUpdatedAt 必須。再開は次回を未来へ置き直す）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status', 'expectedUpdatedAt'], properties: { status: { type: 'string', enum: ['paused', 'active', 'archived'] }, expectedUpdatedAt: { type: 'string' } } } } } },
        responses: { '200': { description: 'Updated report schedule' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Updated elsewhere first' }, '422': { description: 'Validation failed' } },
      },
    },
    '/api/analytics/funnels/{id}': {
      get: {
        tags: ['Analytics'], summary: 'ファネル1件と現在版の全定義（編集画面の読み込み用）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Funnel with current version' }, '404': { description: 'Not found' } },
      },
    },
    '/api/analytics/funnels/{id}/status': {
      put: {
        tags: ['Analytics'], summary: 'ファネルの停止・再開・保管（expectedStatus 必須。保管は終端で復帰不可）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status', 'expectedStatus'], properties: { status: { type: 'string', enum: ['active', 'stopped', 'archived'] }, expectedStatus: { type: 'string', enum: ['active', 'stopped', 'archived'] } } } } } },
        responses: { '200': { description: 'Updated funnel' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Status changed elsewhere first' }, '422': { description: 'Invalid status or transition' } },
      },
    },
    '/api/analytics/audiences/{id}': {
      get: {
        tags: ['Analytics'], summary: '分析の一時対象者の詳細（配信作成の読み直し用。友だちIDは返さない）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Audience detail' }, '404': { description: 'Not found' }, '410': { description: 'Audience expired (24h)' } },
      },
    },
    '/api/analytics/ref/{refCode}/orders': {
      get: {
        tags: ['Analytics'], summary: '流入経路(REF)から来た友だちの注文明細。経路別集計(ref-summaryのorderCount)と同じfirst-touch条件で返す（IDEA-18）',
        parameters: [
          { name: 'refCode', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Orders attributed to the ref code with status summary' }, '403': { description: 'LINEアカウントの表示権限なし' } },
      },
    },
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
    '/api/friends/{id}/form-submissions': {
      get: {
        tags: ['Friends'],
        summary: '友だちのフォーム回答履歴をカーソル式で取得（回答フォームタブ用・PERF-13）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Form submissions page with total count and nextCursor' },
          '404': { description: 'Friend not found in account scope' },
        },
      },
    },
    '/api/friends/{id}/upcoming': {
      get: {
        tags: ['Friends'],
        summary: '友だちの次回予約と次の確定した自動配信を取得（受信箱の顧客情報用・IDEA-02）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Earliest confirmed booking and automated delivery; per-source error flags distinguish fetch failure from none scheduled' },
          '404': { description: 'Friend not found in account scope' },
        },
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
    '/api/friend-fields/reorder': {
      patch: {
        tags: ['Friend Attributes'],
        summary: '友だち情報欄の表示順を一括更新（#1014 ATTR-02/03/04）',
        description:
          '動かせる行だけの新しい順を ids で受け取り、1回のバッチで書く。共通項目（is_inherited）と指定されなかった行の位置は保つ。',
        parameters: [{ name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ids'],
                properties: { ids: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Order updated' },
          '400': { description: 'ids missing or not an array / lineAccountId missing' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Account not in visible scope' },
        },
      },
    },
    '/api/support-marks/reorder': {
      patch: {
        tags: ['Friend Attributes'],
        summary: '対応マークの表示順を一括更新（#1014 ATTR-02/03/04）',
        description:
          '動かせる行だけの新しい順を ids で受け取り、1回のバッチで書く。共有マーク（is_inherited）と指定されなかった行の位置は保つ。共有マークへの行ごと PATCH は複製を起こすため必ずこちらを使う。',
        parameters: [{ name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ids'],
                properties: { ids: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Order updated' },
          '400': { description: 'ids missing or not an array / lineAccountId missing' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Account not in visible scope' },
        },
      },
    },
    '/api/saved-searches/reorder': {
      patch: {
        tags: ['Friend Attributes'],
        summary: '保存した検索の表示順を一括更新（#1014 ATTR-02/03）',
        description:
          '動かせる行だけの新しい順を ids で受け取り、1回のバッチで書く。staff は自分が作った検索だけを動かせ、他人が作った検索と指定されなかった行の位置は保つ。',
        parameters: [{ name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ids'],
                properties: { ids: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Order updated' },
          '400': { description: 'ids missing or not an array / lineAccountId missing' },
          '404': { description: 'Account not in visible scope' },
        },
      },
    },
    '/api/media/{id}': {
      get: {
        tags: ['Contents'],
        summary: '登録メディアの管理用詳細をアカウント範囲内で取得',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Media detail and its folder name' },
          '400': { description: 'Account id is required' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Media not found in account scope' },
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
    '/api/media/{id}/versions/{versionNo}/download': {
      get: {
        tags: ['Contents'],
        summary: '登録メディアの指定した版を認証付きでダウンロード（元ファイルの取り戻し）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'versionNo', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Version file bytes with Content-Disposition: attachment' },
          '400': { description: 'Account id is required' },
          '403': { description: 'Staff role required' },
          '404': { description: 'Media or version not found in account scope' },
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
    /*
     * アーカイブは消去ではない。本文・過去配信からの参照はそのまま使え、
     * 一覧と新規選択からだけ外れる。理由と実行者を監査行へ残すため必須。
     */
    '/api/media/{id}/archive': {
      post: {
        tags: ['Contents'],
        summary: '登録メディアを一覧・新規選択から退避（理由必須）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['accountId', 'reason'],
                properties: {
                  accountId: { type: 'string' },
                  reason: { type: 'string', description: '退避の理由（監査履歴へ残る）' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Archived media item' },
          '400': { description: 'accountId or reason missing' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Media not found in account scope' },
          '409': { description: 'Already archived' },
        },
      },
    },
    '/api/media/{id}/restore': {
      post: {
        tags: ['Contents'],
        summary: '退避した登録メディアを一覧へ戻す（理由必須）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['accountId', 'reason'],
                properties: {
                  accountId: { type: 'string' },
                  reason: { type: 'string', description: '復帰の理由（監査履歴へ残る）' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Restored media item' },
          '400': { description: 'accountId or reason missing' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Media not found in account scope' },
          '409': { description: 'Already active' },
        },
      },
    },
    /*
     * 画像と本文を1回の送信単位にする（N-022）。2回に分けると画像だけが
     * 先に届く部分送信になる。片方だけの送信もこの口で受け付ける。
     */
    '/api/chats/{id}/send-combined': {
      post: {
        tags: ['Chats'],
        summary: '画像と本文を1回で送信',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  image: {
                    type: 'object',
                    properties: {
                      originalContentUrl: { type: 'string' },
                      previewImageUrl: { type: 'string' },
                    },
                  },
                  text: { type: 'string' },
                  revision: { type: 'integer' },
                  quotedMessageId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Sent' },
          '400': { description: 'Idempotency-Key が無い／内容が壊れている' },
          '404': { description: 'Chat not found' },
          '409': { description: '版が食い違う／同じ鍵で内容が違う' },
        },
      },
    },
    /*
     * N-026: 送信内容の差し込み解決プレビュー。/send と同じ解決器を通し、
     * 未解決のまま残る差し込み名を返す(送信はそれらを400で拒否する)。
     * 読み取りのみ。LINE呼出し・履歴書込みは行わない。
     */
    '/api/chats/{id}/render-preview': {
      post: {
        tags: ['Chats'],
        summary: '差し込みを解決した送信プレビューを返す',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  messageType: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '解決済み本文と未解決の差し込み名' },
          '400': { description: 'content が無い／壊れている' },
          '404': { description: 'Chat not found' },
        },
      },
    },
    /*
     * N-025: 返信の送信予約。作成は Idempotency-Key 必須で、時刻は未来のみ。
     * 予約の実行はcronのscheduledジョブがlease付きで行う。
     */
    '/api/chats/{id}/schedule': {
      post: {
        tags: ['Chats'],
        summary: '返信を予約送信する',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  scheduledAt: { type: 'string', format: 'date-time' },
                  quotedMessageId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Scheduled' },
          '400': { description: 'Idempotency-Key・本文・日時のいずれかが不正' },
          '404': { description: 'Chat not found／引用元のメッセージが無い' },
        },
      },
    },
    '/api/chats/{id}/scheduled': {
      get: {
        tags: ['Chats'],
        summary: '会話の送信予約一覧（待機中・送信中）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Pending scheduled sends' },
          '404': { description: 'Chat not found' },
        },
      },
    },
    '/api/chats/{id}/scheduled/{scheduleId}': {
      patch: {
        tags: ['Chats'],
        summary: '送信予約の日時・本文を変更',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'scheduleId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scheduledAt: { type: 'string', format: 'date-time' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated' },
          '400': { description: '変更項目が無い／値が不正' },
          '404': { description: '予約が見つかりません' },
          '409': { description: '送信処理が始まっている／処理済み' },
        },
      },
      delete: {
        tags: ['Chats'],
        summary: '送信予約を取消',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'scheduleId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Cancelled' },
          '404': { description: '予約が見つかりません' },
          '409': { description: '送信処理が始まっている／処理済み' },
        },
      },
    },
    '/api/chats/quick-counts': {
      get: {
        tags: ['Chats'],
        summary: '受信箱クイック絞り込み（すべて／要返信／1時間以上待ち）の件数を現在の条件で集計',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'operatorId', in: 'query', schema: { type: 'string' } },
          { name: 'assignee', in: 'query', schema: { type: 'string' } },
          { name: 'unreadOnly', in: 'query', schema: { type: 'string', enum: ['1', 'true'] } },
          { name: 'channel', in: 'query', schema: { type: 'string', enum: ['all', 'line', 'email'] } },
          { name: 'lineAccountId', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Counts { all, reply, overdue } scoped to the current filters and visible channel' },
          '400': { description: 'channel が不正' },
          '403': { description: 'Staff role required' },
          '404': { description: 'LINE account not found in account scope' },
        },
      },
    },
    '/api/chats/outbound-failures': {
      get: {
        tags: ['Chats'],
        summary: '個別送信の失敗台帳をLINEアカウント範囲内で取得',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Scoped outbound send failures with safe failure codes' },
          '400': { description: 'lineAccountId が未指定' },
          '403': { description: 'Staff role required' },
          '404': { description: 'LINE account not found in account scope' },
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
        parameters: [
          { name: 'lineAccountId', in: 'query', schema: { type: 'string' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['order', 'next', 'created', 'updated', 'name'] } },
        ],
        responses: { '200': { description: 'Visible reminders' }, '400': { description: 'Invalid sort or status' }, '403': { description: 'Staff role required' }, '404': { description: 'LINE account not found in account scope' } },
      },
    },
    '/api/reminders/{id}/registrants': {
      get: {
        tags: ['Reminders'], summary: 'リマインダの登録者を基準日順で取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Visible reminder registrants',
            content: { 'application/json': { schema: {
              type: 'object', required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', const: true },
                data: { type: 'array', items: { $ref: '#/components/schemas/ReminderRegistrant' } },
              },
            } } },
          },
          '401': { description: 'Bearer authentication required' },
          '403': { description: 'Owner, admin, or reminders staff permission required' },
          '404': { description: 'Reminder not found in account scope' },
          '500': { description: 'Failed to read reminder registrants' },
        },
      },
    },
    '/api/reminders/{id}/registrants/{enrollmentId}': {
      patch: {
        tags: ['Reminders'], summary: '登録者の基準日を変更し、旧未送信予定を取り消す',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'enrollmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['targetDate', 'expectedLockVersion'],
          properties: {
            targetDate: { type: 'string', format: 'date-time' },
            expectedLockVersion: { type: 'integer', minimum: 0 },
          },
        } } } },
        responses: {
          '200': {
            description: 'Registrant target date updated or an identical retry replayed',
            content: { 'application/json': { schema: {
              type: 'object', required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', const: true },
                data: { $ref: '#/components/schemas/ReminderRegistrantMutation' },
              },
            } } },
          },
          '400': { description: 'Invalid targetDate or expectedLockVersion' },
          '401': { description: 'Bearer authentication required' },
          '403': { description: 'Owner, admin, or reminders staff permission required' },
          '404': { description: 'Reminder or registrant not found in account scope' },
          '409': { description: 'Registrant lock version conflict' },
          '500': { description: 'Failed to update reminder registrant' },
        },
      },
    },
    '/api/reminders/{id}/registrants/{enrollmentId}/cancel': {
      post: {
        tags: ['Reminders'], summary: '登録者を取り消し、未送信予定だけを止める',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'enrollmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['expectedLockVersion'],
          properties: { expectedLockVersion: { type: 'integer', minimum: 0 } },
        } } } },
        responses: {
          '200': {
            description: 'Registrant cancelled or an identical retry replayed',
            content: { 'application/json': { schema: {
              type: 'object', required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', const: true },
                data: { $ref: '#/components/schemas/ReminderRegistrantMutation' },
              },
            } } },
          },
          '400': { description: 'Invalid expectedLockVersion' },
          '401': { description: 'Bearer authentication required' },
          '403': { description: 'Owner, admin, or reminders staff permission required' },
          '404': { description: 'Reminder or registrant not found in account scope' },
          '409': { description: 'Registrant lock version conflict' },
          '500': { description: 'Failed to cancel reminder registrant' },
        },
      },
    },
    '/api/reminders/{id}/registrants/{enrollmentId}/resume': {
      post: {
        tags: ['Reminders'], summary: '取消済み登録者を再開し、未送信予定を再計算対象へ戻す',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'enrollmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['expectedLockVersion'],
          properties: { expectedLockVersion: { type: 'integer', minimum: 0 } },
        } } } },
        responses: {
          '200': {
            description: 'Registrant resumed or an identical retry replayed',
            content: { 'application/json': { schema: {
              type: 'object', required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', const: true },
                data: { $ref: '#/components/schemas/ReminderRegistrantMutation' },
              },
            } } },
          },
          '400': { description: 'Invalid expectedLockVersion' },
          '401': { description: 'Bearer authentication required' },
          '403': { description: 'Owner, admin, or reminders staff permission required' },
          '404': { description: 'Reminder or registrant not found in account scope' },
          '409': { description: 'Registrant lock version conflict' },
          '500': { description: 'Failed to resume reminder registrant' },
        },
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
    '/api/reminders/{id}/test-recipient': {
      get: {
        tags: ['Reminders'], summary: '下書きのテスト送信で実際に届く送信先の状態を取得（N-070）。recipientKind が本人宛て(self)と登録済みテスト宛先(registered)を区別する（REMINDER-12）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Test recipient state: unset / unavailable / ready, with recipientKind distinguishing self vs registered test recipient' }, '403': { description: 'Staff role required' }, '404': { description: 'Draft not found' } },
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
    '/api/auto-replies/{id}/stop': {
      post: {
        tags: ['Auto replies'], summary: '自動応答を停止し、理由・担当者・日時を記録（E-01）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } },
        responses: { '200': { description: 'Auto reply stopped; stop record returned' }, '400': { description: 'Idempotency-Key header required or invalid reason' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Auto reply not found in account scope' } },
      },
    },
    '/api/auto-reply-runs/{id}/retry': {
      post: {
        tags: ['Auto replies'], summary: '恒久失敗した後続処理だけを保存済みの内容でやり直す（LINEへの返信は送り直さない）（N-081）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Retry executed; evaluation recomputed from all action runs' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Evaluation not found in account scope' }, '409': { description: 'No permanent_failed action runs to claim (already processing or completed)' } },
      },
    },
    '/api/friend-add-runs/{id}/retry': {
      post: {
        tags: ['Webhook'],
        summary: '友だち追加時配信で失敗した処理だけを固定済み内容から再試行（N-102/N-103）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Failed action runs retried; successful actions were not repeated' },
          '400': { description: 'LINE account is required' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Run not found in account scope' },
          '409': { description: 'No failed action is retryable or another retry already won' },
          '500': { description: 'Retry failed safely' },
        },
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
    '/api/mileage/rules/export': {
      get: {
        tags: ['Mileage'], summary: '許可範囲内のたまる決めごとをCSVで書き出し（N-237。監査へ記録）',
        parameters: [{ name: 'accountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Mileage earning rules CSV' }, '400': { description: 'LINE account is required' }, '403': { description: 'Staff role required' }, '404': { description: 'LINE account not found in account scope' } },
      },
    },
    '/api/mileage/earning-rules/{id}/publish': {
      post: {
        tags: ['Mileage'], summary: 'たまる決めごとの下書きを公開版として固定し実行へ反映（N-231 案1）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'expectedVersion'], properties: { accountId: { type: 'string' }, expectedVersion: { type: 'integer', minimum: 1 } } } } } },
        responses: { '200': { description: 'Earning rule published' }, '400': { description: 'Confirmation or version required' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found in account scope' }, '409': { description: 'Draft version conflict or concurrent publish' }, '428': { description: 'Irreversible confirmation required' } },
      },
    },
    '/api/mileage/earning-rules-order': {
      put: {
        tags: ['Mileage'], summary: 'たまる決めごとの並び順を全件まとめて保存（N-243。一覧と一致しない並びは拒否）',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'ids'], properties: { accountId: { type: 'string' }, ids: { type: 'array', items: { type: 'string' }, minItems: 1 } } } } } },
        responses: { '200': { description: 'Earning rule order saved' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'LINE account not found in account scope' }, '409': { description: 'Ids do not match the current earning rule list' }, '422': { description: 'Ids are empty, duplicated, or invalid' } },
      },
    },
    '/api/mileage/rules/{id}': {
      put: {
        tags: ['Mileage'], summary: '所属LINEアカウント内のマイル付与ルールを更新（停止・再開のみ。公開内容の直接変更は409）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Mileage rule updated' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found in account scope' }, '409': { description: 'Legacy global rule is immutable, or direct content edit is closed (N-231)' } },
      },
      delete: {
        tags: ['Mileage'], summary: '所属LINEアカウント内のマイル付与ルールを削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Mileage rule deleted' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found in account scope' }, '409': { description: 'Legacy global rule is immutable' } },
      },
    },
    '/api/mileage/redemptions': {
      get: {
        tags: ['Mileage'], summary: '届かなかった特典交換の一覧を取得（既定は失敗中）',
        parameters: [
          { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['all', 'reserved', 'delivering', 'succeeded', 'delivery_failed', 'refunded'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: { '200': { description: 'Mileage redemptions with failure reason, attempts, and timestamps' }, '400': { description: 'Status is invalid' }, '403': { description: 'Staff role required' }, '404': { description: 'LINE account not found in account scope' } },
      },
    },
    // ── Action Scores ────────────────────────────────────────────────────────
    '/api/action-scores/adjustments': {
      post: {
        tags: ['Mileage'], summary: '担当者が理由つきで1人分の行動スコアを手で直す（N-235。追記台帳・確認ヘッダ必須）',
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'friendId', 'direction', 'amount', 'reason'], properties: { accountId: { type: 'string' }, friendId: { type: 'string' }, direction: { type: 'string', enum: ['increase', 'decrease'] }, amount: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 } } } } } },
        responses: {
          '200': { description: 'Idempotent replay of the recorded adjustment' },
          '201': { description: 'Score adjustment appended to history' },
          '400': { description: 'Idempotency-Key or required fields are invalid' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'LINE account or friend not found in account scope' },
          '409': { description: 'Same idempotency key was used with different content' },
          '422': { description: 'Score would leave the configured band range' },
          '428': { description: 'Irreversible confirmation required' },
        },
      },
    },
    '/api/action-scores/bands/preview': {
      post: {
        tags: ['Mileage'], summary: '編集中の帯の分けかたで各帯の人数だけを数える読み取り専用プレビュー（N-235。公開版・点数は不変）',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'bands'], properties: { accountId: { type: 'string' }, bands: { type: 'object', required: ['min', 'max', 'normalMin', 'highMin'], properties: { min: { type: 'integer', minimum: 0 }, max: { type: 'integer' }, normalMin: { type: 'integer' }, highMin: { type: 'integer' } } } } } } } },
        responses: { '200': { description: 'Band distribution preview' }, '400': { description: 'LINE account is required' }, '403': { description: 'Staff role required' }, '404': { description: 'LINE account not found in account scope' }, '422': { description: 'Band boundaries are invalid' } },
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
    '/api/scenarios/{id}/friends/{friendId}/plan': {
      get: {
        tags: ['Scenarios'],
        summary: '選んだ友だちへの配信予定・待機・分岐理由を副作用なしで試算（IDEA-05）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'friendId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'startAt', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          '200': { description: 'Per-friend delivery plan; no side effects' },
          '400': { description: 'lineAccountId required' },
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
    // ── 友だち単位の購読操作（#949 N-054 / 機能05）─────────────────────────
    '/api/scenario-subscriptions/{subscriptionId}/pause': {
      post: {
        tags: ['Scenarios'],
        summary: '購読の手動停止',
        parameters: [
          { name: 'subscriptionId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' }, description: '操作の確認キー。同じキーの再送は同じ結果を返し、別の購読・別操作への使い回しは409。' },
        ],
        responses: {
          '200': { description: 'Paused' },
          '400': { description: '確認キー不足・不正' },
          '403': { description: '権限不足（scenario.subscription.edit）' },
          '404': { description: '購読なし・他アカウント' },
          '409': { description: '配信処理中・終了済み・確認キーの使い回し' },
        },
      },
    },
    '/api/scenario-subscriptions/{subscriptionId}/resume': {
      post: {
        tags: ['Scenarios'],
        summary: '購読の再開',
        parameters: [
          { name: 'subscriptionId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' }, description: '操作の確認キー。' },
        ],
        responses: {
          '200': { description: 'Resumed' },
          '400': { description: '確認キー不足・不正' },
          '403': { description: '権限不足（scenario.subscription.edit）' },
          '404': { description: '購読なし・他アカウント' },
          '409': { description: '配信処理中・終了済み・再開不可・確認キーの使い回し' },
        },
      },
    },
    '/api/scenario-subscriptions/{subscriptionId}/retry': {
      post: {
        tags: ['Scenarios'],
        summary: '配信失敗で止まった購読の再送',
        parameters: [
          { name: 'subscriptionId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' }, description: '操作の確認キー。' },
        ],
        responses: {
          '200': { description: '再送待ちにした' },
          '400': { description: '確認キー不足・不正' },
          '403': { description: '権限不足（scenario.step_run.retry）' },
          '404': { description: '購読なし・他アカウント' },
          '409': { description: '配信失敗以外・再送不可・確認キーの使い回し' },
        },
      },
    },
    '/api/scenario-subscriptions/{subscriptionId}/move': {
      post: {
        tags: ['Scenarios'],
        summary: '購読を別のシナリオへ移す',
        parameters: [
          { name: 'subscriptionId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' }, description: '操作の確認キー。' },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { targetScenarioId: { type: 'string' } },
                required: ['targetScenarioId'],
              },
            },
          },
        },
        responses: {
          '200': { description: '移した（新しい購読を返す）' },
          '400': { description: '確認キー不足・不正・移し先未指定' },
          '403': { description: '権限不足（scenario.subscription.edit）' },
          '404': { description: '購読なし・移し先なし・他アカウント' },
          '409': { description: '配信処理中・終了済み・移し先に登録済み・確認キーの使い回し' },
          '422': { description: '移し先が停止中・アカウント不一致' },
        },
      },
    },
    // ── Broadcasts ───────────────────────────────────────────────────────────
    '/api/broadcast-message-assets/counts': {
      get: {
        tags: ['Broadcasts'],
        summary: '配信素材の種類別件数を取得（タブ件数用・PERF-04）',
        parameters: [
          { name: 'lineAccountId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Counts keyed by asset kind' },
          '403': { description: 'LINEアカウントの表示権限なし' },
        },
      },
    },
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
    /*
     * 送り始めた配信を止める・続きを送る・失敗した相手だけ送り直す（#662）。
     * どれも `expectedVersion`（画面が読み込んだ版）が要る。版が食い違えば
     * 409 で断り、二重の適用を止める。
     */
    '/api/broadcasts/{id}/stop': {
      post: {
        tags: ['Broadcasts'],
        summary: '送信中の配信を停止',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { expectedVersion: { type: 'integer' } }, required: ['expectedVersion'] } } },
        },
        responses: {
          '200': { description: '停止した（すでに停止済みの再要求も 200）' },
          '400': { description: 'expectedVersion が無い' },
          '409': { description: '送信中でない／全員配信で止められない／版が食い違う' },
        },
      },
    },
    '/api/broadcasts/{id}/resume': {
      post: {
        tags: ['Broadcasts'],
        summary: '停止した配信の続きを送る',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { expectedVersion: { type: 'integer' } }, required: ['expectedVersion'] } } },
        },
        responses: {
          '200': { description: '再開した' },
          '400': { description: 'expectedVersion が無い' },
          '409': { description: '停止中でない／版が食い違う' },
        },
      },
    },
    '/api/broadcasts/{id}/retry-failed': {
      post: {
        tags: ['Broadcasts'],
        summary: '失敗した相手だけ再送（送達不明は含まない）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { expectedVersion: { type: 'integer' } }, required: ['expectedVersion'] } } },
        },
        responses: {
          '202': { description: '再送を受け付けた' },
          '400': { description: 'expectedVersion が無い' },
          '409': { description: '再送できる相手がいない／送信済みでも停止中でもない／版が食い違う' },
          '428': { description: '取り消せない操作の確認を経ていない' },
        },
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
          { name: 'from', in: 'query', description: 'to と両方指定で days の代わりに期間を決める（ISO 8601）', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
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
          { name: 'from', in: 'query', description: 'to と両方指定で days の代わりに期間を決める（ISO 8601）', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
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
          { name: 'q', in: 'query', description: '宛先名・配信名の検索語。履歴全体を検索する', schema: { type: 'string' } },
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
    '/api/nen-campaigns/columns/import': {
      post: {
        tags: ['NEN delivery'],
        summary: '未割り当てのECコラムを選択中のLINEアカウントへ取り込む',
        description: 'EC-CUBE から届いたが宛先が決まらなかったコラム（line_account_id が NULL）を、lineAccountId のアカウントへ割り当てます。',
        parameters: [{ name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '{ imported: number }' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'LINE account not found' },
        },
      },
    },
    '/api/integrations/eccube/coupon-usages': {
      post: {
        tags: ['NEN delivery'],
        summary: 'ECから届く誕生日クーポン利用の記録',
        description: 'HMAC署名で検証する公開口。発行台帳の used_at を立て、注文として成果計測へもつなげる。同じコードの再送は上書きしない。',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', maxLength: 64 },
            used_at: { type: 'string', format: 'date-time' },
            order_number: { type: 'string', maxLength: 64 },
            event_id: { type: 'string', maxLength: 255 },
          },
        } } } },
        responses: {
          '200': { description: 'Usage recorded (or already recorded)' },
          '400': { description: 'Invalid payload' },
          '401': { description: 'Invalid signature' },
          '404': { description: 'Unknown coupon code' },
          '503': { description: 'Integration not configured' },
        },
      },
    },
    '/api/ec-commerce/orders/{id}': {
      get: {
        tags: ['NEN delivery'],
        summary: 'EC注文1件の処理状況（届いた出来事・通知・発送後の案内・成果/マイル/スコア）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Order processing detail' },
          '400': { description: 'LINE account is required' },
          '403': { description: 'ec.event.view permission or account scope required' },
          '404': { description: 'Order not found in account scope' },
        },
      },
    },
    '/api/nen-campaigns/pets': {
      post: {
        tags: ['NEN delivery'],
        summary: 'ペットの登録（管理画面）',
        description: '誕生日は YYYY-MM-DD か MM-DD（月日だけ）。生まれた年が分からない子も誕生日配信の対象にする。',
        parameters: [{ name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['friendId', 'name'],
          properties: {
            friendId: { type: 'string' },
            name: { type: 'string', maxLength: 80 },
            animalType: { type: 'string', enum: ['dog', 'cat', 'other'] },
            gender: { type: 'string', enum: ['male', 'female', 'unknown'] },
            birthday: { type: 'string', description: 'YYYY-MM-DD または MM-DD' },
            breed: { type: 'string', maxLength: 80 },
            weightKg: { type: 'number', minimum: 0.1, maximum: 200, nullable: true },
            customerId: { type: 'string', nullable: true },
          },
        } } } },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Invalid input' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Friend not found in account scope' },
        },
      },
    },
    '/api/nen-campaigns/pets/{id}': {
      put: {
        tags: ['NEN delivery'],
        summary: 'ペット情報の更新（管理画面）',
        description: '誕生日を変えると、古い日付へ予約済みの誕生日クーポン配信は取消し、次の日次処理で組み直す。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', maxLength: 80 },
            animalType: { type: 'string', enum: ['dog', 'cat', 'other'] },
            gender: { type: 'string', enum: ['male', 'female', 'unknown'] },
            birthday: { type: 'string', description: 'YYYY-MM-DD または MM-DD' },
            breed: { type: 'string', maxLength: 80 },
            weightKg: { type: 'number', minimum: 0.1, maximum: 200, nullable: true },
          },
        } } } },
        responses: {
          '200': { description: 'Updated' },
          '400': { description: 'Invalid input' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Pet not found in account scope' },
        },
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
    // ── Staff invitation ────────────────────────────────────────────────────
    '/api/staff/last-logins': {
      get: {
        tags: ['Staff'], summary: '統括メンバーの最終ログイン一覧を取得',
        responses: { '200': { description: 'Last login times by staff id' }, '403': { description: 'Owner or admin role required' } },
      },
    },
    '/api/staff/{id}/resend-invite': {
      post: {
        tags: ['Staff'], summary: '統括メンバーへの招待を再送',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Invitation resent' }, '403': { description: 'Owner or admin with all-account scope required' }, '404': { description: 'Not found in current tenant' }, '409': { description: 'Staff invitation is no longer pending' } },
      },
    },
    '/api/staff/{id}/resend-invitation': {
      post: {
        tags: ['Staff'],
        summary: '未受諾・期限切れのスタッフ招待を再送',
        description: '同じ行を使い回して新しい招待トークンを発行する。旧トークンは即時に失効し、新しい期限は7日。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Invitation resent with a new token and expiry' },
          '400': { description: 'No email address on the staff member' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'Not found in current tenant' },
          '409': { description: 'Already active; nothing to resend' },
          '500': { description: 'Invitation mail could not be sent' },
        },
      },
    },
    '/api/staff/email-change/confirm': {
      post: {
        tags: ['Staff'],
        summary: 'メールアドレス変更を確定',
        description: '確認画面からの POST で確定する。トークンは24時間・使い切り。確定後は旧アドレスへ完了の知らせを送る（N-433）。',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1, maxLength: 512 } },
        } } } },
        responses: {
          '200': { description: 'Email change confirmed and applied' },
          '400': { description: 'Missing or malformed token' },
          '409': { description: 'The new address is already registered' },
          '410': { description: 'Token invalid or expired' },
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
    '/api/line-accounts/connect/check': {
      post: {
        tags: ['LINE Accounts'],
        summary: '4つのチャネル情報でLINE側を自動設定して接続確認',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', maxLength: 40 },
                  channelId: { type: 'string', pattern: '^\\d+$' },
                  channelSecret: { type: 'string', format: 'password' },
                  loginChannelId: { type: 'string', pattern: '^\\d+$' },
                  loginChannelSecret: { type: 'string', format: 'password' },
                },
                required: ['channelId', 'channelSecret', 'loginChannelId', 'loginChannelSecret'],
              },
            },
          },
        },
        responses: { '200': { description: 'Five connection steps; no musubo DB row is created' } },
      },
    },
    '/api/line-accounts/connect': {
      post: {
        tags: ['LINE Accounts'],
        summary: 'LINE側の自動設定・接続確認・アカウント保存',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', maxLength: 40 },
                  channelId: { type: 'string', pattern: '^\\d+$' },
                  channelSecret: { type: 'string', format: 'password' },
                  loginChannelId: { type: 'string', pattern: '^\\d+$' },
                  loginChannelSecret: { type: 'string', format: 'password' },
                },
                required: ['channelId', 'channelSecret', 'loginChannelId', 'loginChannelSecret'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Account created and follower import started when available' },
          '400': { description: 'A connection step failed; no account row remains' },
        },
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
    // ── Webhooks (外部連携) ──────────────────────────────────────────────────
    '/api/webhooks/outgoing/{id}': {
      get: {
        tags: ['Webhook'],
        summary: '送信Webhookの詳細',
        description: '編集画面が現在値を読むための口(#939 N-363)。secret は返さない。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: '詳細' }, '404': { description: 'Not found' } },
      },
    },
    '/api/webhooks/incoming/{id}/unmatched': {
      get: {
        tags: ['Webhook'],
        summary: '人が見つからなかった届物の一覧',
        description: '受信Webhookの「未照合時の扱い」で unmatched_box / create_candidate を選んだ口に'
          + '届いた未確認の一覧(#939 N-367)。照合に使った値と形だけの見本を返し、生の本文は返さない。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['pending', 'resolved', 'dismissed'] } },
        ],
        responses: { '200': { description: '一覧' }, '404': { description: 'Not found' } },
      },
    },
    '/api/webhooks/unmatched/{id}/resolve': {
      post: {
        tags: ['Webhook'],
        summary: '未照合の届物を閉じる',
        description: 'dismiss で何もせず閉じる、link で既存の友だちへ結び付けて閉じる(#939 N-367)。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['action'],
                properties: {
                  action: { type: 'string', enum: ['dismiss', 'link'] },
                  friendId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '閉じた' },
          '400': { description: 'Invalid request' },
          '404': { description: 'Not found' },
          '409': { description: 'すでに処理済み' },
        },
      },
    },
    '/api/webhooks/api-tokens': {
      get: {
        tags: ['Webhook'],
        summary: '公開APIトークンの一覧',
        description: '外部システムが /api/public/v1/* を呼ぶための合言葉の台帳(#939 N-380)。'
          + 'hash・平文は返さず、失効済みは除く。',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: '一覧' } },
      },
      post: {
        tags: ['Webhook'],
        summary: '公開APIトークンの発行',
        description: '平文のトークンはこの応答に1回だけ返す。台帳には SHA-256 hash だけを残す(#939 N-380)。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId', 'name', 'scopes'],
                properties: {
                  lineAccountId: { type: 'string' },
                  name: { type: 'string', minLength: 1, maxLength: 120 },
                  scopes: { type: 'array', items: { type: 'string', enum: ['tags:read', 'tags:write'] } },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: '発行した。data.token に平文が1回だけ入る' },
          '400': { description: 'Invalid request' },
          '403': { description: 'Forbidden' },
        },
      },
    },
    '/api/webhooks/api-tokens/{id}/revoke': {
      post: {
        tags: ['Webhook'],
        summary: '公開APIトークンの失効',
        description: '行は消さず revoked_at に時刻を残す。失効したトークンは即座に使えなくなる(#939 N-380)。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: '失効した' }, '404': { description: 'Not found' } },
      },
    },
    '/api/webhooks/api-tokens/{id}/rotate': {
      post: {
        tags: ['Webhook'],
        summary: '公開APIトークンの再発行',
        description: '旧トークンを即座に失効させ、同じ名前・範囲の新しいトークンを発行する(#939 N-380)。'
          + '新しい平文はこの応答に1回だけ返す。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '再発行した。data.token に新しい平文が1回だけ入る' },
          '404': { description: 'Not found' },
        },
      },
    },
    '/api/public/v1/tags': {
      get: {
        tags: ['Webhook'],
        summary: 'タグ一覧（公開API）',
        description: '外部システム向け公開API(#939 N-380)。管理画面の認証境界の外にあるため'
          + ' security は空。route が `Authorization: Bearer lhp_…` の公開APIトークンを'
          + '自分で照合し、scope tags:read が必要。トークンのアカウントのタグと'
          + '共通タグだけを返す。',
        security: [],
        responses: {
          '200': { description: 'タグ一覧' },
          '401': { description: 'トークンが無いか無効' },
          '403': { description: 'scope 不足' },
        },
      },
    },
    '/api/public/v1/friends/{friendId}/tags': {
      post: {
        tags: ['Webhook'],
        summary: '友だちへのタグ付与（公開API）',
        description: '外部システム向け公開API(#939 N-380)。管理画面の認証境界の外にあるため'
          + ' security は空。route が `Authorization: Bearer lhp_…` の公開APIトークンを'
          + '自分で照合し、scope tags:write が必要。'
          + '友だちはトークンのアカウント所属、タグは同じアカウントか共通で、'
          + '手動付与が禁じられたタグは付けない。管理画面の付与と同じ効果を持つ。',
        security: [],
        parameters: [{ name: 'friendId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tagId'],
                properties: { tagId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'すでに付いていた' },
          '201': { description: '付けた' },
          '400': { description: 'Invalid request' },
          '401': { description: 'トークンが無いか無効' },
          '403': { description: 'scope 不足' },
          '404': { description: 'Not found' },
        },
      },
    },
    // ── Webhooks (保守) ──────────────────────────────────────────────────────
    '/api/webhooks/maintenance/secret-backfill': {
      post: {
        tags: ['Webhook'],
        summary: 'Webhook secret の暗号化移行',
        description: '旧平文・旧鍵のWebhook secretを現行鍵へ寄せ直す(#650)。dryRunは件数だけ数えて書かない。'
          + 'べき等なので中断したら同じ条件で呼び直せば残りが進む。秘密値は要求にも応答にも含めない。',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  lineAccountId: { type: 'string' },
                  dryRun: { type: 'boolean', default: true },
                  batchSize: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
                },
                required: ['lineAccountId'],
              },
            },
          },
        },
        responses: {
          '200': { description: '件数と成否だけの報告' },
          '400': { description: 'Invalid request' },
          '403': { description: 'Forbidden' },
          '503': { description: '鍵がないため移行できない' },
        },
      },
    },
    // ── Conversions ─────────────────────────────────────────────────────────
    '/api/conversions/definitions/{id}/revise': {
      post: {
        tags: ['Conversions'],
        summary: '成果地点を履歴を保ったまま編集して次の版にする',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['expectedVersion', 'name', 'sourceType', 'deduplicationMode', 'valueMode', 'reversalPolicy'],
                properties: {
                  expectedVersion: { type: 'integer', minimum: 1 },
                  name: { type: 'string', minLength: 1, maxLength: 120 },
                  sourceType: { type: 'string' },
                  sourceConfig: { type: 'object' },
                  deduplicationMode: { type: 'string', enum: ['every', 'once_per_friend', 'window'] },
                  deduplicationWindowDays: { type: ['integer', 'null'], minimum: 1, maximum: 365 },
                  valueMode: { type: 'string', enum: ['source', 'fixed', 'none'] },
                  fixedValue: { type: ['number', 'null'], minimum: 0 },
                  reversalPolicy: { type: 'string', enum: ['source_cancelled', 'manual', 'none'] },
                  attributionDays: { type: ['integer', 'null'], minimum: 1, maximum: 365 },
                  targetUrl: { type: ['string', 'null'], maxLength: 2000 },
                  reason: { type: 'string', maxLength: 200 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '次の版になった。過去の成果と集計額は変わらない' },
          '400': { description: '入力または expectedVersion が不正' },
          '403': { description: '編集の権限が無い' },
          '404': { description: '見えない・存在しない成果地点' },
          '409': { description: '版が進んでいる・停止済み・同名がある（副作用は残さない）' },
        },
      },
    },
    '/api/conversions/definitions/{id}/publish': {
      post: {
        tags: ['Conversions'],
        summary: '下書きの成果地点を公開して計測をはじめる',
        description: '下書き(status=draft)の成果地点だけを計測中(active)へ進める。'
          + '公開前の下書きは成果を数えない。過去の記録を失う変更ではない。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['expectedVersion'],
                properties: { expectedVersion: { type: 'integer', minimum: 1 } },
              },
            },
          },
        },
        responses: {
          '200': { description: '計測中になった' },
          '400': { description: 'expectedVersion が不正' },
          '404': { description: '見えない・存在しない成果地点' },
          '409': { description: '版が進んでいる・下書きではない' },
        },
      },
    },
    '/api/conversions/definitions/{id}/ingest-secret': {
      post: {
        tags: ['Conversions'],
        summary: '外部受信の鍵を発行・再発行する',
        description: 'POST /api/conversions/ingest/{id} で使う HMAC 署名の鍵を発行する。'
          + '平文の鍵はこの応答でだけ返り、DBには暗号化して保存する。'
          + '再発行は古い鍵をその場で無効にする。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['expectedVersion'],
                properties: { expectedVersion: { type: 'integer', minimum: 1 } },
              },
            },
          },
        },
        responses: {
          '200': { description: '発行した鍵(平文はこの応答のみ)と受信URL' },
          '400': { description: 'expectedVersion が不正' },
          '404': { description: '見えない・存在しない成果地点' },
          '409': { description: '版が進んでいる' },
        },
      },
    },
    '/api/conversions/definitions/{id}/ingest-disable': {
      post: {
        tags: ['Conversions'],
        summary: '外部からの成果受信を止める(起点停止)',
        description: '受信鍵は消さずに受け口だけ止める。再開は ingest-enable。'
          + '止めている間の受信は拒否として受信履歴に残る。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['expectedVersion'],
                properties: { expectedVersion: { type: 'integer', minimum: 1 } },
              },
            },
          },
        },
        responses: {
          '200': { description: '外部受信を止めた' },
          '400': { description: 'expectedVersion が不正' },
          '404': { description: '見えない・存在しない成果地点' },
          '409': { description: '版が進んでいる' },
        },
      },
    },
    '/api/conversions/definitions/{id}/ingest-enable': {
      post: {
        tags: ['Conversions'],
        summary: '止めた外部受信を再開する',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['expectedVersion'],
                properties: { expectedVersion: { type: 'integer', minimum: 1 } },
              },
            },
          },
        },
        responses: {
          '200': { description: '外部受信を再開した' },
          '400': { description: 'expectedVersion が不正' },
          '404': { description: '見えない・存在しない成果地点' },
          '409': { description: '版が進んでいる' },
        },
      },
    },
    '/api/conversions/definitions/{id}/ingest-events': {
      get: {
        tags: ['Conversions'],
        summary: '外部受信の成否履歴',
        description: '受け取った/再送/拒否の記録。署名・本文・秘密値は含まず、'
          + '署名のSHA-256と本文の項目名だけ残す。isTest=true は検証の受信'
          + '(成果表には書かず実績へ混入しない)。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          '200': { description: '受信の成否履歴(新しい順)' },
          '404': { description: '見えない・存在しない成果地点' },
        },
      },
    },
    '/api/conversions/definitions/{id}/events': {
      get: {
        tags: ['Conversions'],
        summary: '成果1件ずつの一覧',
        description: 'IDEA-19: 成果名の下に1件ごとの状態を返す。status は'
          + ' confirmed(確定)/pending(確認待ち)/rejected(却下)/cancelled(取消)で、'
          + '承認状態と取消台帳から導出済み。検証の受信は成果表へ書かないため'
          + 'この一覧には本番実績だけが並ぶ。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          '200': { description: '成果の一覧(新しい順)' },
          '404': { description: '見えない・存在しない成果地点' },
        },
      },
    },
    '/api/conversions/ingest/{id}': {
      post: {
        tags: ['Conversions'],
        summary: '外部システムからの成果受信(公開口・HMAC署名)',
        description: '管理認証を通さない公開口。X-Conversion-Signature ヘッダに'
          + '本文のHMAC-SHA256(hex)を、X-Conversion-Event-Id または本文の sourceEventId に'
          + '再送を捌くイベントIDを入れる。成否は受信履歴に残る。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sourceEventId: { type: 'string', description: 'ヘッダの代わりに本文で渡せる' },
                  friendId: { type: 'string' },
                  lineUserId: { type: 'string' },
                  value: { type: ['number', 'null'] },
                  metadata: { type: 'object' },
                  test: {
                    type: 'boolean',
                    description: 'true のとき検証の受信。同じ検査を通るが成果表には書かず、'
                      + '受信履歴にだけ残る(売上・報酬・集計へ混入しない)',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '受け取った。duplicated=true なら同じイベントの再送' },
          '400': { description: 'JSONが壊れている・sourceEventIdや友だち特定情報が無い' },
          '401': { description: '署名が無い・違う' },
          '403': { description: '外部受信が止められている' },
          '404': { description: '成果地点が存在しない' },
          '409': { description: '計測中でない・同IDの別内容' },
          '413': { description: '本文が大きすぎる(64KB超)' },
          '422': { description: '友だちが見つからない・対象外' },
          '503': { description: '受信鍵が未発行' },
        },
      },
    },
    '/api/conversions/approvals/bulk': {
      post: {
        tags: ['Conversions'],
        summary: '成果をまとめて承認・却下する',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['items'],
                properties: {
                  items: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 100,
                    items: {
                      type: 'object',
                      required: ['id', 'status', 'expectedStatus'],
                      properties: {
                        id: { type: 'string' },
                        status: { type: 'string', enum: ['approved', 'rejected'] },
                        expectedStatus: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '成功ID・競合ID・権限拒否ID・失敗IDに分けて返す' },
          '400': { description: 'itemsが0件・101件以上' },
          '403': { description: '承認の権限が無い' },
        },
      },
    },
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
    // ── Templates (#645 公開版固定) ─────────────────────────────────────────
    '/api/templates/{id}/publish': {
      post: {
        tags: ['Templates'],
        summary: 'テンプレートの下書きを公開版へ写す',
        description: 'Idempotency-Key ヘッダ(必須)で再試行を見分ける。下書きがなくても成功し、その確認キーを版・下書き版・下書き指紋つきで記録する。同じ確認キー・同じ内容の再試行は記録時の版・本文をそのまま返す(固定応答)。同じ確認キーで別の下書きを出す使い回しは409。公開版(expectedVersion)・下書き版(expectedDraftRevision)が進んでいたら409。新規作成は未公開(版0)で始まり、初回の公開で版1になる。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 }, description: '公開操作の確認キー。必須。同じキーの再試行は同じ結果を返す。' },
        ],
        requestBody: { content: { 'application/json': { schema: {
          type: 'object',
          required: ['expectedVersion', 'expectedDraftRevision'],
          properties: {
            expectedVersion: { type: 'integer', minimum: 0, description: '確認したときの公開版。必須。進んでいたら409。' },
            expectedDraftRevision: { type: 'integer', minimum: 0, description: '確認したときの下書き版。必須。書き換わっていたら409。' },
          },
        } } } },
        responses: {
          '200': { description: '公開成功 { published: true }・再試行 { published: false, replayed: true }・下書きなし成功 { published: false, replayed: false }。data に publishedVersion・publishedAt・hasDraft・draftRevision を返す。' },
          '400': { description: '確認キー不足・版の番号が数でない' },
          '404': { description: 'Not found in account scope' },
          '409': { description: '公開版の同時更新の負け・下書きの書き換わり・確認キーの別操作への使い回し' },
        },
      },
    },
    // ── Settings ─────────────────────────────────────────────────────────────
    '/api/settings/features/visibility': {
      get: {
        tags: ['Settings'],
        summary: '一般スタッフ向けの機能表示可否を取得',
        description: '画面の殻に必要な機能ごとの表示可否booleanだけを返す。契約、会社設定、依存理由、並び順などの管理情報は返さない。',
        parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Feature visibility booleans only' },
          '400': { description: 'account_id is required' },
          '403': { description: 'Account scope denied' },
        },
      },
    },
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
    // ── Operation alerts ────────────────────────────────────────────────────
    '/api/operations/alerts': {
      get: {
        tags: ['Operations'],
        summary: '運用異常の対応状況と通知結果を一覧する',
        description: '指定したLINEアカウント内だけの異常、受領・解消・再開履歴、通知結果をowner/adminへ返す。',
        parameters: [
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'include_resolved', in: 'query', required: false, schema: { type: 'string', enum: ['0', '1'] } },
        ],
        responses: {
          '200': { description: '運用異常の一覧、通知集計、イベント履歴' },
          '400': { description: 'LINEアカウントが未指定' },
          '403': { description: 'owner/adminではない、またはアカウント範囲外' },
          '500': { description: '一覧取得失敗' },
        },
      },
    },
    '/api/operations/alerts/{id}/acknowledge': {
      post: {
        tags: ['Operations'],
        summary: '運用異常を受領して対応中にする',
        description: '表示中の版をexpectedVersionとして受け取り、同じ管理者・同じメモの再試行だけを重複成功として扱う。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['lineAccountId', 'expectedVersion'],
          properties: {
            lineAccountId: { type: 'string' },
            expectedVersion: { type: 'integer', minimum: 1 },
            note: { type: 'string' },
          },
        } } } },
        responses: {
          '200': { description: '受領済みの異常。duplicate=trueは同一内容の再試行' },
          '400': { description: '受領内容が不正' },
          '403': { description: 'owner/adminではない、またはアカウント範囲外' },
          '404': { description: '指定アカウント内に異常が存在しない' },
          '409': { description: '版、管理者、またはメモが競合' },
          '500': { description: '受領の保存失敗' },
        },
      },
    },
    '/api/operations/alerts/{id}/notifications/retry': {
      post: {
        tags: ['Operations'],
        summary: '失敗または未設定だった運用異常通知を再試行する',
        description: '連絡先を設定した後を含め、指定アカウント内の未送信通知を再び送信待ちへ戻す。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          required: ['lineAccountId'],
          properties: { lineAccountId: { type: 'string' } },
        } } } },
        responses: {
          '200': { description: '再試行へ戻した通知件数' },
          '400': { description: 'LINEアカウントが未指定' },
          '403': { description: 'owner/adminではない、またはアカウント範囲外' },
          '404': { description: '指定アカウント内に異常が存在しない' },
          '500': { description: '再試行受付失敗' },
        },
      },
    },
    '/api/operations/incidents/{id}/restore-preview': {
      post: {
        tags: ['Operations'],
        summary: '復旧前に停止中の定義変更・追加・削除・期限切れを検査する',
        description: '停止時に保存した定義の版・期限の指紋と現在の定義を比較し、能力ごとの再開可否と理由を返す。読み取り専用。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '能力ごとのdrift検査結果（unchanged/changed/deleted/inactive/added/expired）' },
          '403': { description: 'owner/adminではない、緊急操作権限がない、またはアカウント範囲外' },
          '404': { description: '緊急操作の記録が存在しない' },
          '409': { description: '停止中のincidentではない' },
          '500': { description: '検査失敗' },
        },
      },
    },
    '/api/operations/send-paths': {
      get: {
        tags: ['Operations'],
        summary: '緊急停止が届く送信経路の台帳を一覧する',
        description: '外部へ届く送信経路ごとに、どの停止対象で止まるか・現在の状態・対象外の理由を返す。台帳と実装の食い違いはproblemsとして返す。',
        parameters: [{ name: 'account_id', in: 'query', required: false, schema: { type: 'string' } }],
        responses: {
          '200': { description: '経路一覧・停止対象ごとの状態・台帳の検査結果' },
          '403': { description: 'owner/adminではない、またはアカウント範囲外' },
          '500': { description: '一覧取得失敗' },
        },
      },
    },
    // ── AI development reports ──────────────────────────────────────────────
    '/api/integrations/ai-loop/reports': {
      post: {
        tags: ['Operations'],
        summary: 'AI開発タスクの状態をSlackへ一方向で報告',
        description: '署名済みの開始・完了・失敗・人間確認イベントだけを専用チャンネルへ表示する。Slackからの実行指示や承認は受け付けない。',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['version', 'eventId', 'taskId', 'repository', 'title', 'commander', 'executor', 'model', 'status', 'summary', 'taskUrl', 'occurredAt', 'revision'],
                properties: {
                  version: { type: 'integer', const: 1 },
                  eventId: { type: 'string', minLength: 3, maxLength: 255 },
                  taskId: { type: 'string', minLength: 1, maxLength: 120 },
                  repository: { type: 'string', pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' },
                  title: { type: 'string', minLength: 1, maxLength: 120 },
                  commander: { type: 'string', enum: ['codex', 'claude'] },
                  executor: { type: 'string', enum: ['meta', 'codex'] },
                  model: { type: 'string', minLength: 1, maxLength: 80 },
                  status: { type: 'string', enum: ['started', 'completed', 'failed', 'approval'] },
                  summary: { type: 'string', minLength: 1, maxLength: 500 },
                  taskUrl: { type: 'string', format: 'uri' },
                  prUrl: { type: 'string', format: 'uri' },
                  occurredAt: { type: 'string', format: 'date-time' },
                  revision: { type: 'integer', minimum: 946684800000, description: '状態確定時刻のUnixミリ秒。再実行を含め単調増加させる。' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Report created, updated, or ignored as stale' },
          '400': { description: 'Invalid report payload' },
          '401': { description: 'Invalid signature' },
          '503': { description: 'Report channel is not configured' },
        },
      },
    },
    // ── Operator notifications ──────────────────────────────────────────────
    '/api/notifications/operator-event-types': {
      get: {
        tags: ['Operator notifications'],
        summary: '運用者通知が自動発火できるきっかけ一覧',
        description: '公開済みルールが反応できる業務イベントと、実producerへの接続状況を返す。connected=false は未接続で、そのきっかけでは自動発火しない。',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'きっかけ一覧（items[].connected と publishedRules、summary の接続済み・未接続件数）' },
          '400': { description: 'lineAccountId が無い' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
        },
      },
    },
    '/api/notifications/operator-outbox/sweep': {
      post: {
        tags: ['Operator notifications'],
        summary: '送り残した運用者通知の回収と再送',
        description: 'Worker中断や一時失敗で pending / retry_wait のまま残った送達を拾い直して送る。冪等キーで取るため同時実行でも二重送信しない。',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  lineAccountId: { type: 'string', description: '省略時は権限内の全アカウントを対象にする' },
                  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '回収結果（swept, accepted, excluded, failed, pending）' },
          '403': { description: 'このLINEアカウントを変更する権限がない' },
        },
      },
    },
    // ── LINE通知（機能24の正本API。/api/notifications 配下は互換用） ──────────
    '/api/line-notifications/operator-rules': {
      get: {
        tags: ['Operator notifications'],
        summary: '運用者へのお知らせルール一覧',
        description: '選択中LINEアカウントの運用者通知ルールと、本日の発生・受理・対象外の集計を返す。',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'ルール一覧（items と summary）' },
          '400': { description: 'lineAccountId が無い' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
        },
      },
      post: {
        tags: ['Operator notifications'],
        summary: '運用者へのお知らせルールを作る',
        description: '下書きとしてルールを1件作る。公開は publish で行う。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId', 'name', 'eventType'],
                properties: {
                  lineAccountId: { type: 'string' },
                  name: { type: 'string' },
                  eventType: { type: 'string' },
                  conditions: { type: 'object' },
                  channels: { type: 'array', items: { type: 'string', enum: ['dashboard', 'email', 'line'] } },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: '作成したルール' },
          '400': { description: '必須項目または通知方法の指定が不正' },
          '403': { description: 'このLINEアカウントを変更する権限がない' },
        },
      },
    },
    '/api/line-notifications/operator-rules/{id}': {
      get: {
        tags: ['Operator notifications'],
        summary: '運用者へのお知らせルール1件',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'ルール1件' },
          '400': { description: 'lineAccountId が無い' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
          '404': { description: 'お知らせが見つからない' },
        },
      },
    },
    '/api/line-notifications/operator-rules/{id}/draft': {
      patch: {
        tags: ['Operator notifications'],
        summary: '運用者へのお知らせルールの下書きを保存',
        description: '名前・きっかけ・条件・通知方法を保存する。公開・停止は publish / stop で行い、isActive は受け付けない。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId'],
                properties: {
                  lineAccountId: { type: 'string' },
                  name: { type: 'string' },
                  eventType: { type: 'string' },
                  conditions: { type: 'object' },
                  channels: { type: 'array', items: { type: 'string', enum: ['dashboard', 'email', 'line'] } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '保存したルール' },
          '400': { description: '必須項目または通知方法の指定が不正' },
          '403': { description: 'このLINEアカウントを変更する権限がない' },
          '404': { description: 'お知らせが見つからない' },
          '409': { description: 'isActive が指定された（公開・停止は別の操作で行う）' },
        },
      },
    },
    '/api/line-notifications/operator-rules/recipients-preview': {
      post: {
        tags: ['Operator notifications'],
        summary: '受け取る人の到達可否プレビュー',
        description: '作成前のルール向けに、指定した受け取る人と通知方法で実際に届くかを返す。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId', 'channels'],
                properties: {
                  lineAccountId: { type: 'string' },
                  recipientIds: { type: 'array', items: { type: 'string' } },
                  channels: { type: 'array', items: { type: 'string', enum: ['dashboard', 'email', 'line'] } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '受け取る人ごとの到達可否と集計' },
          '400': { description: '必須項目の指定が不正' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
        },
      },
    },
    '/api/line-notifications/operator-rules/{id}/recipients-preview': {
      post: {
        tags: ['Operator notifications'],
        summary: 'ルールの受け取る人到達可否プレビュー',
        description: '保存済みルールの受け取る人・通知方法を既定にプレビューする。本文で上書きもできる。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId'],
                properties: {
                  lineAccountId: { type: 'string' },
                  recipientIds: { type: 'array', items: { type: 'string' } },
                  channels: { type: 'array', items: { type: 'string', enum: ['dashboard', 'email', 'line'] } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '受け取る人ごとの到達可否と集計' },
          '400': { description: '必須項目または通知方法の指定が不正' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
          '404': { description: 'お知らせが見つからない' },
        },
      },
    },
    '/api/line-notifications/operator-rules/{id}/publish': {
      post: {
        tags: ['Operator notifications'],
        summary: '運用者へのお知らせを公開',
        description: 'きっかけが実際に接続されていて、受け取れる人が1人以上いるときだけ公開できる。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId'],
                properties: { lineAccountId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: '公開したルール' },
          '400': { description: 'lineAccountId が無い' },
          '403': { description: 'このLINEアカウントを変更する権限がない' },
          '404': { description: 'お知らせが見つからない' },
          '409': { description: 'きっかけ未接続・受け取る人なし等で公開できない' },
        },
      },
    },
    '/api/line-notifications/operator-rules/{id}/stop': {
      post: {
        tags: ['Operator notifications'],
        summary: '運用者へのお知らせを停止',
        description: '新規受付を止める。送信中のものは取り消さない。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId'],
                properties: { lineAccountId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: '停止したルール' },
          '400': { description: 'lineAccountId が無い' },
          '403': { description: 'このLINEアカウントを変更する権限がない' },
          '404': { description: 'お知らせが見つからない' },
        },
      },
    },
    '/api/line-notifications/operator-rules/{id}/test': {
      post: {
        tags: ['Operator notifications'],
        summary: '運用者へのお知らせのテスト送信',
        description: '操作した本人だけを受け取る人にして試行送信する。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId'],
                properties: {
                  lineAccountId: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'テスト送信の結果' },
          '400': { description: 'lineAccountId が無い' },
          '403': { description: 'このLINEアカウントを変更する権限がない' },
          '404': { description: 'お知らせが見つからない' },
          '409': { description: '自分の受信設定が無い' },
        },
      },
    },
    '/api/line-notifications/operator-event-types': {
      get: {
        tags: ['Operator notifications'],
        summary: '運用者通知が自動発火できるきっかけ一覧',
        description: '/api/notifications/operator-event-types と同じ。要件の正本名。',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'きっかけ一覧（items[].connected と publishedRules、summary の接続済み・未接続件数）' },
          '400': { description: 'lineAccountId が無い' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
        },
      },
    },
    '/api/line-notifications/operator-events': {
      post: {
        tags: ['Operator notifications'],
        summary: '運用者通知イベントの手動発火',
        description: '登録簿にあるきっかけを1件発火し、公開済みルールへ送る。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lineAccountId', 'eventType', 'sourceEventId'],
                properties: {
                  lineAccountId: { type: 'string' },
                  eventType: { type: 'string' },
                  sourceEventId: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '発火したルールの結果一覧' },
          '400': { description: '必須項目が無い・きっかけが登録簿に無い' },
          '403': { description: 'このLINEアカウントを変更する権限がない' },
        },
      },
    },
    '/api/line-notifications/operator-outbox/sweep': {
      post: {
        tags: ['Operator notifications'],
        summary: '送り残した運用者通知の回収と再送',
        description: '/api/notifications/operator-outbox/sweep と同じ。要件の正本名。',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  lineAccountId: { type: 'string', description: '省略時は権限内の全アカウントを対象にする' },
                  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '回収結果（swept, accepted, excluded, failed, pending）' },
          '403': { description: 'このLINEアカウントを変更する権限がない' },
        },
      },
    },
    '/api/line-notifications/operator-deliveries.csv': {
      get: {
        tags: ['Operator notifications'],
        summary: '運用者通知の実行記録CSV',
        description: 'アカウント内の運用者向け送達をCSVで書き出す。理由は必須で監査へ残る。',
        parameters: [
          { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'reason', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'CSV(text/csv; charset=utf-8、BOM付き)' },
          '400': { description: 'lineAccountId・reason が無い' },
          '403': { description: 'このLINEアカウントを出力する権限がない' },
        },
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
    // ── Booking settings (N-406 #754) ────────────────────────────────────────
    '/api/booking/admin/settings': {
      get: {
        tags: ['Booking'],
        summary: '店舗共通の予約ルールを取得',
        description: '設定行がまだ無い店舗は、表示と初回保存に使う version=0 の既定値を返す。この取得ではDB行を作成しない。businessHoursConfigured=false の0行曜日は後方互換で営業時間制限なし、true の0行曜日は休業。',
        parameters: [
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '店舗共通ルール、メニュー件数、営業時間、例外日' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
          '404': { description: 'LINEアカウントが存在しない' },
          '503': { description: '設定を取得できない' },
        },
      },
      put: {
        tags: ['Booking'],
        summary: '店舗共通の予約ルールを版付きで作成・更新',
        description: 'expectedVersion=0 は設定行が無い実在店舗だけに初回行を作る。既存行は版一致時だけ更新する。businessHoursを指定した場合は7曜日を原子的に置換し、0行曜日を休業として明示設定する。',
        parameters: [
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'expectedVersion', 'timeZone', 'bookingWindowDays',
                  'cutoffMinutesBefore', 'cancelDeadlineMinutesBefore',
                  'maxActiveBookingsPerFriend', 'approvalMode', 'holdMinutes',
                  'slotGranularityMinutes',
                ],
                properties: {
                  expectedVersion: { type: 'integer', minimum: 0 },
                  timeZone: { type: 'string', minLength: 1, maxLength: 100 },
                  bookingWindowDays: { type: 'integer', minimum: 1, maximum: 365 },
                  cutoffMinutesBefore: { type: 'integer', minimum: 0, maximum: 43200 },
                  cancelDeadlineMinutesBefore: { type: 'integer', minimum: 0, maximum: 43200 },
                  maxActiveBookingsPerFriend: { type: 'integer', minimum: 1, maximum: 100 },
                  approvalMode: { type: 'string', enum: ['automatic', 'manual'] },
                  holdMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
                  slotGranularityMinutes: { type: 'integer', enum: [5, 10, 15, 30, 60] },
                  businessHours: {
                    type: 'array', minItems: 7, maxItems: 7,
                    description: 'weekday 0（日曜）〜6（土曜）を各1回。空のintervalsは休業。24:00と日またぎは不可。',
                    items: {
                      type: 'object',
                      required: ['weekday', 'intervals'],
                      properties: {
                        weekday: { type: 'integer', minimum: 0, maximum: 6 },
                        intervals: {
                          type: 'array', maxItems: 8,
                          items: {
                            type: 'object', required: ['start', 'end', 'capacity'],
                            properties: {
                              start: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
                              end: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
                              capacity: { type: 'integer', minimum: 1, maximum: 1000 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated' },
          '201': { description: 'Created' },
          '400': { description: 'Invalid request' },
          '403': { description: 'Owner or admin role required, or account is outside access scope' },
          '404': { description: 'LINE account not found' },
          '409': { description: 'Version conflict' },
          '503': { description: 'Settings unavailable' },
        },
      },
    },
    '/api/booking/admin/exceptions/{id}': {
      delete: {
        tags: ['Booking'],
        summary: '予約の例外日（休業日・臨時営業）を版付きで削除',
        description: '消す直前の版を expectedVersion で確認し、先に別の変更が入っていたら409で止める。別アカウントのIDは404として隠す。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['expectedVersion'],
          properties: { expectedVersion: { type: 'integer', minimum: 1 } },
        } } } },
        responses: {
          '200': { description: 'Deleted' },
          '400': { description: 'Invalid request' },
          '403': { description: 'Owner or admin role required, or account is outside access scope' },
          '404': { description: '例外日が存在しない' },
          '409': { description: '版競合' },
          '503': { description: '例外日を削除できない' },
        },
      },
    },
    '/api/booking/admin/resources': {
      get: {
        tags: ['Booking'], summary: '予約設備を利用状況と版付きで一覧取得',
        parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '設備、版、更新日時、メニュー・予約・例外日の参照件数' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
          '503': { description: '設備を取得できない' },
        },
      },
      post: {
        tags: ['Booking'], summary: '予約設備を作成',
        parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['name', 'type', 'capacity'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            type: { type: 'string', minLength: 1, maxLength: 50 },
            capacity: { type: 'integer', minimum: 1, maximum: 1000 },
            isActive: { type: 'boolean', default: true },
          },
        } } } },
        responses: {
          '201': { description: '作成済み設備' }, '400': { description: 'Invalid request' },
          '403': { description: 'Owner or admin role required, or account is outside access scope' },
          '503': { description: '設備を作成できない' },
        },
      },
    },
    '/api/booking/admin/resources/{id}': {
      patch: {
        tags: ['Booking'], summary: '予約設備を版付きで変更・停止・再開',
        description: '稼働中の設備は、将来予約の最大同時使用量またはメニュー割当の必要数を下回るcapacityへ縮小できない。メニュー割当が競合する場合は、先にメニュー側の設備割当を変更する。停止は既存予約を残して新規受付だけを閉じる。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['expectedVersion'],
          anyOf: [
            { required: ['name'] },
            { required: ['type'] },
            { required: ['capacity'] },
            { required: ['isActive'] },
          ],
          properties: {
            expectedVersion: { type: 'integer', minimum: 1 },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            type: { type: 'string', minLength: 1, maxLength: 50 },
            capacity: { type: 'integer', minimum: 1, maximum: 1000 },
            isActive: { type: 'boolean' },
          },
        } } } },
        responses: {
          '200': { description: '変更済み設備' }, '400': { description: 'Invalid request' },
          '403': { description: 'Owner or admin role required, or account is outside access scope' },
          '404': { description: '設備が存在しない' },
          '409': { description: '版競合、予約使用量を下回る縮小、またはメニュー割当の必要数を下回る縮小（先にメニュー割当を変更）' },
          '503': { description: '設備を変更できない' },
        },
      },
      delete: {
        tags: ['Booking'], summary: '未参照の予約設備を版付きで削除',
        description: 'メニュー、予約時点の消費snapshot、資源例外日から参照中なら削除せず、停止を案内する。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['expectedVersion'],
          properties: { expectedVersion: { type: 'integer', minimum: 1 } },
        } } } },
        responses: {
          '200': { description: 'Deleted' }, '400': { description: 'Invalid request' },
          '403': { description: 'Owner or admin role required, or account is outside access scope' },
          '404': { description: '設備が存在しない' },
          '409': { description: '版競合または参照中' },
          '503': { description: '設備を削除できない' },
        },
      },
    },
    '/api/booking/admin/menus/{id}/resources': {
      put: {
        tags: ['Booking'], summary: '予約メニューへ必要な設備と数量を版付きで一括割当',
        description: '割当全体を原子的に置換する。停止中・別アカウント・不存在の設備は同じエラーで拒否し、既存予約の設備snapshotは変更しない。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['expectedVersion', 'resources'],
          properties: {
            expectedVersion: { type: 'integer', minimum: 1 },
            resources: {
              type: 'array', maxItems: 30, uniqueItems: true,
              items: {
                type: 'object', additionalProperties: false, required: ['resourceId', 'quantity'],
                properties: {
                  resourceId: { type: 'string', minLength: 1 },
                  quantity: { type: 'integer', minimum: 1, maximum: 1000 },
                },
              },
            },
          },
        } } } },
        responses: {
          '200': { description: '更新後のメニュー版と、この保存で確定した割当' },
          '400': { description: '入力不備、または設備を利用できない' },
          '403': { description: 'Owner or admin role required, or account is outside access scope' },
          '404': { description: '対象アカウントにメニューが存在しない' },
          '409': { description: 'メニュー版が更新済み' },
          '503': { description: '設備割当を保存できない' },
        },
      },
    },
    '/api/booking/admin/availability-check': {
      get: {
        tags: ['Booking'],
        summary: '指定した日時に予約を受けられるかと、受けられない場合の理由を確認',
        description: '予約設定画面の「この日時はなぜ取れないか」用。読み取り専用で予約は作らない。判定は実際の空き枠計算と同じ入力・同じ手順を使い、受けられない場合は理由コード（勤務外・休業日・所要時間超過・既存予約との重複・外部カレンダーの予定・定員・設備不足など）を返す。他担当の非公開予定の件名・相手など詳細は含めない。',
        parameters: [
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'menu_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'staff_id', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
          { name: 'time', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{2}:\\d{2}$' } },
        ],
        responses: {
          '200': { description: 'bookable（受けられるか）、reasons（理由コードの一覧）、per_staff（担当ごとの可否・残数・理由）' },
          '400': { description: 'account_id・menu_id・date・time の不足または形式不正' },
          '403': { description: 'このLINEアカウントを表示する権限がない' },
        },
      },
    },
    // ── Booking detail edit / retry / audit (N-389〜N-394 #932) ─────────────
    '/api/booking/admin/bookings.csv': {
      get: {
        tags: ['Booking'], summary: '予約台帳をCSVで書き出す',
        description: '一覧（/api/booking/admin/requests）と同じ絞り込み（status・query・menu_name・staff_id・source・from・to）を受け付け、画面に見えている分だけをCSVで返す。最大5000件までで、打ち切ったときは先頭の注記行に件数上限を明記する。UTF-8 BOM付きCRLF。',
        parameters: [
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string', default: 'requested' } },
          { name: 'query', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'menu_name', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'staff_id', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'source', in: 'query', required: false, schema: { type: 'string', enum: ['liff', 'phone', 'counter', 'operator', 'import'] } },
          { name: 'from', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'to', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '予約台帳CSV（text/csv、BOM付き、最大5000件）' },
          '400': { description: 'account_id 未指定' },
          '403': { description: '台帳の閲覧権限がない、または担当外アカウント' },
        },
      },
    },
    '/api/booking/admin/bookings/{id}': {
      patch: {
        tags: ['Booking'], summary: '予約内容を版付きで変更',
        description: 'requested/confirmed の予約だけ変更できる。lock_version 必須の楽観ロックで、日時・担当・メニュー・料金・メモ・通知方針を変える。変更対象の予約自身は重なり・席数・資源ガードから外す。LINE未連携の予約へ送信系方針をオンにはできない。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['lock_version'],
          properties: {
            lock_version: { type: 'integer', minimum: 0 },
            menu_id: { type: 'string' },
            staff_id: { type: 'string' },
            starts_at: { type: 'string', format: 'date-time' },
            price: { type: 'integer', minimum: 0, maximum: 100000000 },
            customer_note: { type: ['string', 'null'], maxLength: 2000 },
            internal_note: { type: ['string', 'null'], maxLength: 2000 },
            notification_policy: {
              type: 'object',
              description: 'この予約だけの通知可否。変更したいキーだけ送る。',
              properties: {
                send_line_confirmation: { type: 'boolean' },
                day_before: { type: 'boolean' },
                hours_before: { type: 'boolean' },
              },
            },
            send_change_notification: { type: 'boolean', description: 'false で今回の変更案内を送らない' },
            reason: { type: 'string', maxLength: 200, description: '変更履歴に残す理由' },
          },
        } } } },
        responses: {
          '200': { description: '変更後の版・カレンダー同期・通知・リマインダの実績' },
          '400': { description: 'JSON不備または lock_version 未指定' },
          '404': { description: '予約または担当が対象アカウントに存在しない' },
          '409': { description: '版競合・変更不可の状態・枠の衝突' },
          '422': { description: 'メニュー未提供・過去日時・料金不備・方針不備・未連携への送信指定' },
        },
      },
    },
    '/api/booking/admin/bookings/{id}/audit-logs': {
      get: {
        tags: ['Booking'], summary: '予約の変更履歴を新しい順に取得',
        description: '誰が・いつ・何を変えたかのappend-only履歴。対象アカウントの予約だけ返す。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } },
        ],
        responses: {
          '200': { description: '変更履歴の一覧' },
          '400': { description: 'account_id 未指定' },
          '404': { description: '予約が対象アカウントに存在しない' },
        },
      },
    },
    '/api/booking/admin/bookings/{id}/sync/retry': {
      post: {
        tags: ['Booking'], summary: '失敗したGoogleカレンダー反映を現在の予約状態で再試行',
        description: 'retry_wait / permanent_failed の google_calendar 台帳行だけを対象に、同じ行を再利用して再実行する。確定予約は反映、取消・期限切れは削除、未設定は skipped で閉じる。実行中（queued）は409。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '再試行の結果状態' },
          '400': { description: 'account_id 未指定' },
          '404': { description: '予約が対象アカウントに存在しない' },
          '409': { description: '再試行できる失敗が無い、または実行中' },
        },
      },
    },
    '/api/booking/admin/bookings/{id}/notifications/{runId}/retry': {
      post: {
        tags: ['Booking'], summary: '失敗したLINE通知を同じ台帳行のまま再送',
        description: 'confirmation_line の失敗行だけを対象に再送する。成功済み・取消済みは409、未連携の予約は422。再送の成否は台帳行へ error_code と共に残し、変更履歴にも記録する。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'runId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '再送の結果と台帳の状態' },
          '400': { description: 'account_id 未指定' },
          '404': { description: '予約または台帳行が対象アカウントに存在しない' },
          '409': { description: '成功済み・取消済み・実行中' },
          '422': { description: 'LINE未連携の予約' },
        },
      },
    },
    // ── Booking staff breaks (N-405 #655) ────────────────────────────────────
    '/api/booking/admin/staff/{id}/breaks': {
      get: {
        tags: ['Booking'],
        summary: '担当者の休憩一覧取得',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Breaks with version' }, '404': { description: 'Staff not in account' } },
      },
      put: {
        tags: ['Booking'],
        summary: '担当者の休憩を週全体で置き換え',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { expectedVersion: { type: 'string' }, breaks: { type: 'array', maxItems: 28, items: { type: 'object', properties: { id: { type: 'string' }, weekday: { type: 'integer', minimum: 0, maximum: 6 }, start_time: { type: 'string' }, end_time: { type: 'string' } }, required: ['weekday', 'start_time', 'end_time'] } } }, required: ['breaks', 'expectedVersion'] } } } },
        responses: { '200': { description: 'Replaced with version' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Staff not in account' }, '409': { description: 'Version conflict' }, '422': { description: 'Invalid weekday, overlap, outside hours, or time range' } },
      },
    },
    '/api/booking/admin/staff/{id}/break-dates': {
      get: {
        tags: ['Booking'],
        summary: '担当者の日付指定の休憩一覧取得',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Date breaks with version' }, '404': { description: 'Staff not in account' } },
      },
      put: {
        tags: ['Booking'],
        summary: '担当者の日付指定の休憩を全体で置き換え',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { expectedVersion: { type: 'string' }, breaks: { type: 'array', maxItems: 366, items: { type: 'object', properties: { id: { type: 'string' }, work_date: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' } }, required: ['work_date', 'start_time', 'end_time'] } } }, required: ['breaks', 'expectedVersion'] } } } },
        responses: { '200': { description: 'Replaced with version' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Staff not in account' }, '409': { description: 'Version conflict' }, '422': { description: 'Invalid date, DST gap, overlap, outside hours, or time range' } },
      },
    },
    // ── Booking staff self link (N-411 #866) ─────────────────────────────
    '/api/booking/admin/staff/me': {
      get: {
        tags: ['Booking'],
        summary: 'ログイン中ユーザーに紐づく予約スタッフの一覧（本人勤務の対象解決）',
        parameters: [
          { name: 'account_id', in: 'query', required: false, schema: { type: 'string' }, description: '指定時はそのアカウントの紐づけだけを返す。省略時は全アカウント分。' },
        ],
        responses: {
          '200': { description: 'Linked booking staff records' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'booking.staff.own permission required (staff role)' },
        },
      },
    },
    // ── Booking staff×menu matrix bulk save (N-410 #819) ──────────────────
    '/api/booking/admin/staff-menus': {
      put: {
        tags: ['Booking'],
        summary: '担当者×メニューの割り当てを全員分まとめて置き換え（全件成功または全件不適用）',
        parameters: [
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { staff: { type: 'array', items: { type: 'object', properties: { staff_id: { type: 'string' }, menus: { type: 'array', items: { type: 'object', properties: { menu_id: { type: 'string' }, is_offered: { type: 'boolean' }, override_duration_minutes: { type: ['integer', 'null'] }, override_price: { type: ['integer', 'null'] } }, required: ['menu_id', 'is_offered'] } } }, required: ['staff_id', 'menus'] } } }, required: ['staff'] } } } },
        responses: { '200': { description: 'Replaced' }, '400': { description: 'Invalid request' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Staff or menu not found in account' }, '422': { description: 'Duplicate staff_id' } },
      },
    },
    // ── Forms ────────────────────────────────────────────────────────────
    '/api/forms/unassigned': {
      get: {
        tags: ['Forms'],
        summary: '担当の決まっていない旧フォームだけを返す（管理者確認 #724）',
        parameters: [
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '未割り当てフォームの一覧' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: '権限範囲外（一般staff・制限付き・別テナント）' },
        },
      },
    },
    '/api/forms/{id}/submissions/{submissionId}/retry-effects': {
      post: {
        tags: ['Forms'],
        summary: '完了しなかった回答の後処理だけを、予約(claim)の工程記録に沿って再実行する(N-168)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'submissionId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '再実行結果。完了済みの回答は complete: true で返す' },
          '403': { description: 'Owner or admin role required' },
          '404': { description: 'フォーム・回答が無い、または権限範囲外' },
          '409': { description: '後処理の記録(claim)が無い回答' },
          '429': { description: '別の処理が進行中' },
        },
      },
    },
    '/api/forms/{id}/publish': {
      post: {
        tags: ['Forms'],
        summary: '保存済みのフォーム編集版を不変の公開版として公開',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['expectedContentRevision'],
                properties: { expectedContentRevision: { type: 'integer', minimum: 1 } },
              },
            },
          },
        },
        responses: {
          '200': { description: '公開済み（同じ編集版の再実行を含む）' },
          '400': { description: '確認した編集版が不正' },
          '404': { description: 'フォームが無い、または権限範囲外' },
          '409': { description: '保存後に編集内容が変わった' },
        },
      },
    },
    // ── Event applicant operations ─────────────────────────────────────────
    '/api/events/admin/events/{id}/occurrence-selector': {
      get: {
        tags: ['Events'],
        summary: '申込者画面用の開催回選択肢を取得',
        description: '予約件数・集計を含めず、指定LINEアカウントに属する有効な開催回だけを返す。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '開催回のID、日時、定員、並び順' },
          '400': { description: 'account_id が無い' },
          '403': { description: 'イベント閲覧権限が無い' },
          '404': { description: 'イベントが無い、またはアカウント範囲外' },
        },
      },
    },
    '/api/events/admin/occurrences/{id}/applicants.csv': {
      get: {
        tags: ['Events'],
        summary: '表示時に固定した開催回申込者をCSVで書き出す',
        description: 'snapshot_id は申込者画面の取得時に発行される短期ID。後から申込・取消があっても、同じ表示対象だけを書き出す。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'snapshot_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'UTF-8 BOM付きCSV', content: { 'text/csv': { schema: { type: 'string' } } } },
          '400': { description: 'account_id が無い' },
          '403': { description: 'イベント閲覧権限が無い' },
          '404': { description: '開催回またはsnapshotがアカウント範囲外' },
          '409': { description: 'snapshotの内容が不正' },
          '410': { description: 'snapshotの期限切れ' },
          '422': { description: 'snapshot_id が無い' },
        },
      },
    },
    '/api/events/admin/occurrences/{id}/applicant-broadcasts/preview': {
      post: {
        tags: ['Events'],
        summary: '固定済みの開催回申込者を一斉案内の下書きへ保存',
        description: '同じIdempotency-Keyと同じ内容は、後から申込者が変わっても固定済み宛先を再生する。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['title', 'messageContent', 'snapshotId'],
          properties: {
            title: { type: 'string', minLength: 1 },
            messageContent: { type: 'string', minLength: 1, maxLength: 5000 },
            snapshotId: { type: 'string' },
          },
        } } } },
        responses: {
          '200': { description: '同じ冪等キーの下書きを再生', headers: { 'Idempotency-Replayed': { schema: { type: 'boolean' } } } },
          '201': { description: '送信前確認用の下書きを作成' },
          '400': { description: 'アカウント、冪等キー、または本文が不正' },
          '403': { description: 'owner/admin権限が無い' },
          '404': { description: '開催回またはsnapshotがアカウント範囲外' },
          '409': { description: '冪等キーが別内容に使われた、またはsnapshotが不正' },
          '410': { description: 'snapshotの期限切れ' },
          '422': { description: 'snapshotId が無い' },
        },
      },
    },
    // ── Event waitlist ────────────────────────────────────────────────────
    '/api/liff/events/waitlist/{token}/accept': {
      post: {
        tags: ['Events'],
        summary: 'キャンセル待ちの繰上げ案内を本人が承諾',
        security: [],
        parameters: [
          {
            name: 'token',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 32, maxLength: 256 },
            description: 'LINEで本人へ送った期限付き案内token',
          },
        ],
        responses: {
          '200': { description: '確定予約へ変換済み（同じ案内の再実行を含む）' },
          '401': { description: 'LINE本人確認に失敗' },
          '404': { description: '案内なし、または案内対象と異なるLINEユーザー' },
          '409': { description: '満席・本人上限などにより確定不能' },
          '410': { description: '回答期限切れ' },
        },
      },
    },
    // ── Rich Menus (publish schedules) ────────────────────────────────────
    '/api/rich-menu-groups/{groupId}/schedule': {
      post: {
        tags: ['Rich Menus'],
        summary: 'リッチメニューの公開予約を作成',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { mode: { type: 'string', enum: ['scheduled', 'period'] }, startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' }, restoreGroupId: { type: 'string' } }, required: ['mode', 'startsAt'] } } } },
        responses: { '201': { description: 'Schedule created' }, '200': { description: 'Same Idempotency-Key content exists' }, '400': { description: 'Invalid input' }, '404': { description: 'Not found' }, '409': { description: 'Idempotency-Key used with different content' } },
      },
    },
    '/api/rich-menu-groups/{groupId}/schedules': {
      get: {
        tags: ['Rich Menus'],
        summary: 'リッチメニューの公開予約一覧を取得',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Schedules with status and retry info' }, '404': { description: 'Not found' } },
      },
    },
    '/api/rich-menu-groups/{groupId}/schedules/{scheduleId}/cancel': {
      post: {
        tags: ['Rich Menus'],
        summary: '実行前の公開予約を取り消し',
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'scheduleId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Cancelled' }, '404': { description: 'Not found' }, '409': { description: 'Already started' } },
      },
    },
    // ── Rich Menus (運用: 履歴・再試行・照合・複製・集計・テスト適用) ──────
    '/api/rich-menu-groups/{groupId}/publish-runs': {
      get: {
        tags: ['Rich Menus'],
        summary: 'リッチメニューの公開履歴を取得（版・状態・最終エラー・LINE ID）',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Publish runs newest first' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' } },
      },
    },
    '/api/rich-menu-groups/{groupId}/publish-runs/{requestId}/retry': {
      post: {
        tags: ['Rich Menus'],
        summary: '失敗した公開runだけを保存された版のまま再試行（owner/admin）',
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'requestId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Retry result or replayed success' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Run still in progress' } },
      },
    },
    '/api/rich-menu-groups/{groupId}/reconcile': {
      post: {
        tags: ['Rich Menus'],
        summary: 'DBとLINEのずれを点検（dryRun）し、明示したときだけ修復（owner/admin）',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { dryRun: { type: 'boolean' } } } } } },
        responses: { '200': { description: 'Diffs listed or repaired' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' }, '502': { description: 'LINE state unreadable' } },
      },
    },
    '/api/rich-menu-groups/{groupId}/duplicate': {
      post: {
        tags: ['Rich Menus'],
        summary: 'メニュー全体（ページ・ボタン・画像参照・出し分け）を下書きとして複製（owner/admin）',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } },
        responses: { '201': { description: 'Duplicated as a new draft' }, '200': { description: 'Same Idempotency-Key replayed' }, '400': { description: 'Idempotency-Key header required' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' }, '409': { description: 'Idempotency-Key used with different content' } },
      },
    },
    '/api/rich-menu-groups/{groupId}/audience-summary': {
      get: {
        tags: ['Rich Menus'],
        summary: 'このメニューが実際に出る人数の集計だけを返す（staff可・個人情報なし）',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Aggregate counts only' }, '404': { description: 'Not found or not visible' }, '503': { description: 'Counts unavailable' } },
      },
    },
    '/api/rich-menu-groups/{groupId}/test-apply': {
      get: {
        tags: ['Rich Menus'],
        summary: '本人LINEへのテスト適用の状態を取得（連携済みか・適用中か）',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Link state and active apply' }, '404': { description: 'Not found or not visible' } },
      },
      post: {
        tags: ['Rich Menus'],
        summary: '本人確認済みのLINEだけへテスト適用（owner/admin・confirm必須）',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'boolean', const: true } } } } } },
        responses: { '200': { description: 'Applied to operator LINE' }, '400': { description: 'Not linked or confirm missing' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' }, '409': { description: 'Another apply in progress or key conflict' } },
      },
    },
    '/api/rich-menu-groups/{groupId}/test-apply/revert': {
      post: {
        tags: ['Rich Menus'],
        summary: 'テスト適用を取り消し、適用前のメニューへ戻す（冪等・owner/admin）',
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'boolean', const: true }, applyId: { type: 'string' } } } } } },
        responses: { '200': { description: 'Reverted (idempotent)' }, '400': { description: 'confirm required' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'No active apply' }, '409': { description: 'Conflicting revert in progress' } },
      },
    },
    // ── Common Vars (audited async CSV export, N-192) ─────────────────────
    '/api/common-vars/exports': {
      get: {
        tags: ['Common Vars'],
        summary: '共通情報CSVの書き出し台帳一覧を取得',
        parameters: [{ name: 'accountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Recent export jobs for the account' }, '400': { description: 'accountId query param required' }, '404': { description: 'Account not found or not visible' } },
      },
      post: {
        tags: ['Common Vars'],
        summary: '共通情報CSVの非同期書き出しを依頼（owner/admin）',
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['accountId'], properties: { accountId: { type: 'string' }, folderId: { type: 'string', nullable: true }, ungrouped: { type: 'boolean' } } } } } },
        responses: { '201': { description: 'Export job queued; returns job with progress' }, '400': { description: 'Invalid request or folder' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Account not found or not visible' } },
      },
    },
    '/api/common-vars/exports/{id}': {
      get: {
        tags: ['Common Vars'],
        summary: '書き出しの状態・進捗を取得（期限超過の完了行は expired に確定）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Job status, progress and downloadUrl' }, '404': { description: 'Not found or not visible' } },
      },
    },
    '/api/common-vars/exports/{id}/download': {
      get: {
        tags: ['Common Vars'],
        summary: '完成したCSVを期限付きでダウンロード（owner/admin）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'text/csv attachment' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' }, '409': { description: 'Not downloadable yet' }, '410': { description: 'Download expired; regenerate required' } },
      },
    },
    '/api/common-vars/exports/{id}/regenerate': {
      post: {
        tags: ['Common Vars'],
        summary: '同じ条件で書き出しを作り直す（owner/admin）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'New export job queued with the same filter' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' } },
      },
    },
    '/api/automation-runs/{id}': {
      get: {
        tags: ['Automations'],
        summary: '実行記録1件の詳細を取得（版番号・テスト印・処理ごとの結果）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Run detail with pinned version number, test flag and per-step results' },
          '403': { description: 'Automations permission required' },
          '404': { description: 'Run not found in account scope' },
        },
      },
    },
    '/api/automation-runs/{id}/cancel': {
      post: {
        tags: ['Automations'],
        summary: '終わっていない実行を取りやめる（記録は残る）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Run cancelled (idempotent for already-cancelled runs)' },
          '403': { description: 'Automations permission required' },
          '404': { description: 'Run not found in account scope' },
          '409': { description: 'Run already finished and cannot be cancelled' },
        },
      },
    },
    '/api/automations/{id}/draft': {
      post: {
        tags: ['Automations'],
        summary: '公開済みオートメーションに改訂用の下書きを作る（冪等）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '201': { description: 'Draft created or the existing draft returned' },
          '403': { description: 'Automations permission required' },
          '404': { description: 'Automation not found in account scope' },
        },
      },
    },
    '/api/automations/{id}/duplicate': {
      post: {
        tags: ['Automations'],
        summary: 'オートメーションを複製して新しい下書きにする',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '201': { description: 'Duplicated draft created' },
          '403': { description: 'Automations permission required' },
          '404': { description: 'Automation not found in account scope' },
        },
      },
    },
    '/api/automations/{id}/status': {
      post: {
        tags: ['Automations'],
        summary: 'オートメーションの稼働状態を切り替える（active/stopped/archived）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['status'],
          properties: { status: { type: 'string', enum: ['active', 'stopped', 'archived'] } },
        } } } },
        responses: {
          '200': { description: 'Status updated (archived is one-way)' },
          '400': { description: 'Invalid status value' },
          '403': { description: 'Automations permission required' },
          '404': { description: 'Automation not found in account scope' },
          '409': { description: 'Status changed concurrently' },
          '422': { description: 'Transition not allowed (e.g. archived restore, unpublished activate)' },
        },
      },
    },
  },
  tags: [
    { name: 'Friends', description: '友だち管理' },
    { name: 'HQ Templates', description: '統括ひな形の作成・事前検査・店舗配布' },
    { name: 'Tags', description: 'タグ管理' },
    { name: 'Friend Attributes', description: '友だち情報欄・対応マーク・保存した検索' },
    { name: 'Scenarios', description: 'ステップ配信シナリオ' },
    { name: 'Broadcasts', description: '一斉配信' },
    { name: 'NEN delivery', description: 'NEN専用配信・コラム・ペット実績' },
    { name: 'Users', description: 'UUID Cross-Account ユーザー管理' },
    { name: 'LINE Accounts', description: 'マルチLINEアカウント管理' },
    { name: 'Conversions', description: 'コンバージョン計測' },
    { name: 'Affiliates', description: 'アフィリエイト管理' },
    { name: 'Booking', description: '予約設定' },
    { name: 'Events', description: 'イベント予約とキャンセル待ち' },
    { name: 'Templates', description: 'テンプレート公開版' },
    { name: 'Forms', description: '回答フォーム' },
    { name: 'Rich Menus', description: 'リッチメニュー公開予約' },
    { name: 'Common Vars', description: '共通情報と監査付きCSV書き出し' },
    { name: 'Automations', description: 'オートメーションの定義・実行記録' },
    { name: 'Settings', description: '機能設定' },
    { name: 'Operator notifications', description: '運用者へのお知らせの自動実行' },
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
