import { api5Paths } from './api5-openapi.js';
export const hqTemplateMediaPaths = {
'/api/hq/templates/media': {
      get: api5Paths['/api/hq/templates/media'].get,
      post: {
        tags: ['HQ Templates'], summary: '統括ひな形のPNG/JPEG画像を登録',
        parameters: [
          { name: 'purpose', in: 'query', required: true, schema: { type: 'string', enum: ['message', 'rich_menu', 'rich_message', 'rich_video_preview'] } },
          { name: 'filename', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 } },
          { name: 'width', in: 'query', required: false, schema: { type: 'integer' }, description: '採用できる幅。画像が違う寸法なら登録せず422' },
          { name: 'height', in: 'query', required: false, schema: { type: 'integer' }, description: '採用できる高さ。画像が違う寸法なら登録せず422' },
        ],
        requestBody: { required: true, content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } },
        responses: { '201': { description: '統括の画像。rich_message・rich_video_previewは原本と5サイズのmediaとbaseUrl/baseSizeを返す。message/rich_menuの同一再送は既存画像を再利用する' }, '403': { description: 'Tenant-wide owner/admin write permission required' }, '422': { description: 'Invalid image, dimensions, size or unconfirmed upload' } },
      },
      delete: {
        tags: ['HQ Templates'], summary: '採用されなかった統括ひな形の画像を回収（所有確認つき）',
        parameters: [
          { name: 'r2Key', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Deleted flag; missing objects are a no-op' }, '403': { description: 'Tenant-wide owner/admin write permission required' }, '404': { description: 'Outside the caller tenant ownership' }, '422': { description: 'Invalid image key' } },
      },
    },
};
