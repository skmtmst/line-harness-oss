// Definitions only. Runtime handlers remain in their feature routes.
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
