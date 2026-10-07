import { CHAT_FILE_TYPES, CHAT_VIDEO_MAX_BYTES } from '@line-crm/shared';
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const responses = {
  '200': { description: '保存済みの添付・送信結果' },
  '201': { description: '新しく保存した添付・アップロード予約' },
  '400': { description: '形式・大きさ・期限・JSONが不正' },
  '401': { description: '未認証' }, '403': { description: '受信箱の変更権限がない' },
  '404': { description: 'この会話の添付または送信先がない' },
  '409': { description: '送信キーの重複・アップロード期限切れ・ETag不一致' },
  '422': { description: '動画の内容と形式が一致しない' },
  '502': { description: '保存または送信に失敗' }, '503': { description: '直接アップロードの設定がない' },
};
const jsonBody = (schema: Record<string, unknown>) => ({ required: true, content: { 'application/json': { schema } } });
export const chatAttachmentPaths: Record<string, unknown> = {
  '/api/chats/{id}/attachments/upload': { post: {
    tags: ['Chats'], summary: 'JPEG/PNG画像・PDF・DOCX・XLSX・PPTX・ZIPを10MBまでアップロード',
    parameters: [id, { name: 'X-Filename', in: 'header', required: true, schema: { type: 'string' }, description: 'UTF-8でpercent-encodeした元ファイル名' }],
    requestBody: { required: true, content: Object.fromEntries(['image/jpeg', 'image/png', ...Object.keys(CHAT_FILE_TYPES)].map(mime => [mime, { schema: { type: 'string', format: 'binary' } }])) },
    responses,
  } },
  '/api/chats/{id}/attachments/upload-sessions': { post: {
    tags: ['Chats'], summary: 'MP4動画のR2直接アップロードを準備（最大200MB・URLは15分）', parameters: [id],
    requestBody: jsonBody({ type: 'object', required: ['filename', 'mimeType', 'sizeBytes'], properties: {
      filename: { type: 'string', maxLength: 200 }, mimeType: { const: 'video/mp4' }, sizeBytes: { type: 'integer', minimum: 1, maximum: CHAT_VIDEO_MAX_BYTES },
    } }), responses,
  } },
  '/api/chats/{id}/attachments/upload-sessions/{sessionId}/complete': { post: {
    tags: ['Chats'], summary: '動画のサイズ・内容・所属・ETagを照合して確定', parameters: [id, { name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: jsonBody({ type: 'object', required: ['etag'], properties: { etag: { type: 'string' } } }), responses,
  } },
  '/api/chats/{id}/send': { post: {
    tags: ['Chats'], summary: 'テキスト・Flex・画像・動画・ファイルを担当者の個別返信として送信',
    description: 'videoのcontentはJSONのoriginalContentUrlと任意のpreviewImageUrl。fileのcontentはJSONのattachmentId。ファイルは名前・大きさ・期限付きURLのテキストとして届く。',
    parameters: [id, { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: jsonBody({ type: 'object', required: ['content'], properties: {
      content: { type: 'string' }, messageType: { type: 'string', enum: ['text', 'flex', 'image', 'video', 'file'], default: 'text' },
      revision: { type: 'integer' }, quotedMessageId: { type: 'string' },
    } }), responses,
  } },
};
