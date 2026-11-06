/** 公開フォームで採用した表示参照。元の値や管理APIの応答は保存しない。 */
export const STORE_INFORMATION_FIELDS = ['displayName', 'address', 'phone', 'hours', 'guideUrl', 'mapUrl'] as const;
export type StoreInformationField = typeof STORE_INFORMATION_FIELDS[number];
export type FormReferenceDefinition =
  | { blockId: string; kind: 'image'; mediaId: string; versionNo: number; alt: string }
  | { blockId: string; kind: 'store_information'; fields: Partial<Record<StoreInformationField, { varKey: string }>> };

export type PublicFormImage = { url: string; alt: string; width: number; height: number; mimeType: string; versionId: string };
export type PublicStoreInformation = {
  displayName?: string; address?: string; phone?: string;
  hours?: Array<{ label: string; text: string }>; guideUrl?: string; mapUrl?: string;
};
type ReferenceContent = { image: PublicFormImage; store_information: PublicStoreInformation };
export type PublicFormReference = {
  [K in keyof ReferenceContent]:
    | { blockId: string; kind: K; state: 'ready'; content: ReferenceContent[K] }
    | { blockId: string; kind: K; state: 'empty' | 'unavailable' | 'context_required' | 'retryable_error' }
}[keyof ReferenceContent];

const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value);
/** 余分な項目を切り捨てて公開参照だと誤認しない。保存前に形を拒否する。 */
export function parseFormReferences(input: unknown): FormReferenceDefinition[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) return null;
  const result: FormReferenceDefinition[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (!id(row.blockId) || seen.has(row.blockId)) return null;
    seen.add(row.blockId);
    if (row.kind === 'image') {
      if (Object.keys(row).some(key => !['blockId', 'kind', 'mediaId', 'versionNo', 'alt'].includes(key))
        || !id(row.mediaId) || !Number.isSafeInteger(row.versionNo) || Number(row.versionNo) < 1
        || typeof row.alt !== 'string' || row.alt.length > 1000) return null;
      result.push({ blockId: row.blockId, kind: 'image', mediaId: row.mediaId, versionNo: Number(row.versionNo), alt: row.alt });
    } else if (row.kind === 'store_information') {
      if (Object.keys(row).some(key => !['blockId', 'kind', 'fields'].includes(key))
        || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)) return null;
      const fields = Object.entries(row.fields);
      if (fields.some(([key, value]) => !(STORE_INFORMATION_FIELDS as readonly string[]).includes(key) || (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'varKey' || !id((value as Record<string, unknown>).varKey)))) return null;
      result.push({ blockId: row.blockId, kind: 'store_information', fields: Object.fromEntries(fields) as Extract<FormReferenceDefinition, { kind: 'store_information' }>['fields'] });
    } else return null;
  }
  return result;
}
