// 実行時の副作用を混ぜず定義だけを置き、ハンドラは各機能の経路に保つ。
export const lineWebhookPaths = {
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
};
