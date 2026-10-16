export type MessageTemplateSourceMediaBinding = Readonly<{
  tenantId: string;
  templateVersionId: string;
  sourceAccountId: string;
  mediaId: string;
  mediaVersionId: string;
  versionNo: number;
  r2Key: string;
  r2KeyPrefix: string;
  sizeBytes: number;
  contentHash: string;
  etag: string | null;
}>;
