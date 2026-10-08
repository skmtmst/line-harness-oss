/** 受信箱の添付。動画はAPI-6と同じR2直接アップロードを使う。 */
export const CHAT_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_PREVIEW_MAX_BYTES = 1024 * 1024;
export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_FILE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CHAT_FILE_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
} as const;

export interface ChatVideoContent { originalContentUrl: string; previewImageUrl?: string }
export interface ChatFileContent { attachmentId: string }
export type ChatSendMessageType = 'text' | 'flex' | 'image' | 'video' | 'file';
export interface ChatSendInput {
  /** image/video: JSONのURL対、file: JSONの {attachmentId}、text: 本文。 */
  content: string;
  messageType?: ChatSendMessageType;
  revision?: number;
  quotedMessageId?: string;
}
export interface ChatScheduleInput extends Omit<ChatSendInput, 'revision'> {
  scheduledAt: string;
}
export interface ChatAttachment {
  id: string;
  key: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'video' | 'file';
  /** ファイルのみアップロードから30日。画像・動画はnull。 */
  expiresAt: string | null;
}
export interface ChatAttachmentUploadSession {
  id: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}
