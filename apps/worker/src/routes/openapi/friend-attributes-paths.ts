// Definitions only. Runtime handlers remain in their feature routes.
export const friendAttributesPaths = {
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
  '/api/folders/{id}/swap-order': {
    post: {
      tags: ['Friend Attributes'],
      summary: '隣り合う2つのフォルダの並びを入れ替える（V6R-S2-c）',
      description:
        '2つの表示順を1回のバッチで書く。番号が同じ2つは、後ろへ行くほうを +1 して並びを入れ替える。同じ種類・同じアカウント・同じ親のフォルダ同士だけ受け付ける。全部の兄弟は振り直さない（同時に触った人の並びを上書きしないため）。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['withId'],
              properties: {
                withId: { type: 'string', description: '入れ替える相手のフォルダ' },
                accountId: { type: 'string', description: 'アカウント単位のフォルダの所有アカウント（ウェビナーは必須）' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Order swapped' },
        '400': { description: 'withId missing, same folder, or folders not in the same place' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Folder not found or not in visible scope' },
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
};
