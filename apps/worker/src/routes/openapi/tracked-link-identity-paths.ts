export const trackedLinkIdentityPaths = {
  '/api/liff/tracked-link-identity': {
    post: {
      tags: ['Friends'],
      summary: '計測リンク用の本人確認トークンを発行',
      description: 'リンクのLINEアカウントに対してLINE IDトークンを検証し、同じアカウントの友だちに限定した5分間有効のトークンを返す。応答はキャッシュしない。',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['linkId', 'idToken'],
              properties: {
                linkId: { type: 'string' },
                idToken: { type: 'string', description: 'LINE Loginが発行した本人確認用IDトークン' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'リンクと友だちに結び付いた署名付きトークン',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', enum: [true] },
                  data: { type: 'object', properties: { token: { type: 'string' } } },
                },
              },
            },
          },
        },
        '400': { description: '入力形式が不正' },
        '401': { description: '本人確認ができない' },
        '404': { description: '対象のリンクまたは友だちが見つからない' },
        '503': { description: 'LINEアカウントが停止中または利用できない' },
      },
    },
  },
};
