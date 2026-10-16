import type { HqTemplateSnapshotToken } from './contract.js';
export type MessageTemplateTargetSnapshot = Readonly<{
  tenantId: string;
  targetAccountId: string;
  snapshotToken: HqTemplateSnapshotToken;
  templates: readonly Readonly<{ id: string; name: string; updatedAt: string }>[];
  media: readonly Readonly<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    r2Key: string;
    publicUrl: string | null;
    contentHash: string;
    revision: string;
    versionNo: number;
  }>[];
}>;
