// Definitions only. Runtime handlers remain in their feature routes.
export const mediaScanningPaths = {
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
   * 危険なファイルの検査。clean になるまで中身は出さない。
   * 一覧・設定・戻し・消去は owner/admin だけ。状態確認は staff も見られる。
   */
  '/api/file-scans': {
    get: {
      tags: ['Contents'],
      summary: 'ファイル検査の一覧をアカウント範囲内で取得（owner/admin）',
      parameters: [
        { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        { name: 'offset', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      responses: {
        '200': { description: 'File scan list with uploader labels' },
        '400': { description: 'Account id is required' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Account not in scope' },
      },
    },
  },
  '/api/file-scans/by-subject': {
    get: {
      tags: ['Contents'],
      summary: '上げたファイルの検査状態を対象指定で取得',
      parameters: [
        { name: 'kind', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'File scan status or null' },
        '403': { description: 'Staff role required' },
        '404': { description: 'Account not in scope' },
      },
    },
  },
  '/api/file-scans/for-media': {
    get: {
      tags: ['Contents'],
      summary: '登録メディアの最新の検査状態を取得',
      parameters: [
        { name: 'mediaId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'File scan status or null' },
        '403': { description: 'Staff role required' },
        '404': { description: 'Account not in scope' },
      },
    },
  },
  '/api/file-scans/health': {
    get: {
      tags: ['Contents'],
      summary: '検査が止まっているかを確認',
      parameters: [
        { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Stopped flag with pending counts' },
        '403': { description: 'Staff role required' },
        '404': { description: 'Account not in scope' },
      },
    },
  },
  '/api/file-scans/config': {
    get: {
      tags: ['Contents'],
      summary: '外の検査サービスの設定を取得（owner/admin。鍵は返さない）',
      parameters: [
        { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'File scan config or null' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Account not in scope' },
      },
    },
    put: {
      tags: ['Contents'],
      summary: '外の検査サービスの設定を保存（owner/admin）',
      responses: {
        '200': { description: 'Saved line account id' },
        '400': { description: 'Account id is required, or endpoint is not https' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Account not in scope' },
      },
    },
  },
  '/api/file-scans/{id}/retry': {
    post: {
      tags: ['Contents'],
      summary: 'ファイル検査をもう一度回す（owner/admin）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Scan back to pending' },
        '400': { description: 'Account id is required' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Scan not found in account scope' },
      },
    },
  },
  '/api/file-scans/{id}/release': {
    post: {
      tags: ['Contents'],
      summary: 'しまったファイルを誤りのため戻す。理由は必須（owner/admin）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Scan released to clean with reason recorded' },
        '400': { description: 'Account id and reason are required' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Scan not found in account scope' },
        '409': { description: 'Only quarantined scans can be released' },
      },
    },
  },
  '/api/file-scans/{id}': {
    delete: {
      tags: ['Contents'],
      summary: 'しまった・使えないファイルを消す（owner/admin）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Deleted scan id' },
        '400': { description: 'Account id is required' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Scan not found in account scope' },
        '409': { description: 'Only quarantined or rejected scans can be deleted' },
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
};
