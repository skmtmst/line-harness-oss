// Definitions only. Runtime handlers remain in their feature routes.
export const webinarsPaths = {
  // ── Webinars（動画素材の準備・開催回の定員。J-1・N #821） ──────────────
  '/api/webinars/{id}/video-asset': {
    get: {
      tags: ['Webinars'], summary: '動画素材の準備段階を取得',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Video asset stage' }, '404': { description: 'Webinar not found' } },
    },
  },
  '/api/webinars/{id}/video-asset/advance': {
    post: {
      tags: ['Webinars'], summary: '動画素材の準備段階を1段進める',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['stage'],
        properties: {
          stage: { type: 'string', enum: ['uploaded', 'inspecting', 'converting', 'packaging', 'thumbnail', 'ready', 'failed'] },
          errorCode: { type: 'string' },
          durationSeconds: { type: ['integer', 'null'], minimum: 0 },
        },
      } } } },
      responses: {
        '200': { description: 'Stage advanced' },
        '400': { description: 'Invalid stage or body' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Webinar not found' },
        '409': { description: 'Stage transition not allowed' },
      },
    },
  },
  '/api/webinars/{id}/sessions/{startAt}': {
    get: {
      tags: ['Webinars'], summary: '開催回の定員と残席を取得',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'startAt', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: {
        '200': { description: 'Session capacity and remaining seats' },
        '400': { description: 'Invalid session start' },
        '404': { description: 'Webinar not found' },
      },
    },
    put: {
      tags: ['Webinars'], summary: '開催回の定員を設定（nullで無制限に戻す）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'startAt', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object',
        properties: { capacity: { type: ['integer', 'null'], minimum: 1 } },
      } } } },
      responses: {
        '200': { description: 'Session capacity updated' },
        '400': { description: 'Invalid session start or capacity' },
        '403': { description: 'Owner or admin role required' },
        '404': { description: 'Webinar not found' },
      },
    },
  },
};
