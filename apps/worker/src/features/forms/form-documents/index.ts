// 不要な操作まで初期化しないよう、操作単位の公開入口を分ける。
export { IDENTITY_RETENTION_KEY, attachDocumentAnswers, documentAnswer, documentExpired, documentIds, hydrateDocumentAnswers, identityRetentionDays, purgeExpiredFormDocuments, purgeUnsafeFormDocuments, uploadedDocumentKind, validateDocumentAnswers } from '../form-documents.js';
export type { FormDocumentRow } from '../form-documents.js';
