import type { HqTemplateAuthority,HqTemplateAdapterInput,HqTemplateReference } from './contract.js';
export interface RichMenuReferenceResolver {
  (reference: HqTemplateReference, targetAccountId: string): Promise<string | null | { targetId: string; operation: 'reuse' | 'create'; expectedRevision?: string }>;
}

export interface RichMenuAdapterOptions {
  db: D1Database; bucket: Pick<R2Bucket, 'head' | 'get' | 'put' | 'delete'>;
  authority: HqTemplateAuthority;
  /** 1つの不変版へ束縛し、別テンプレートに同じ生成元を再利用しない。 */
  input: HqTemplateAdapterInput;
  resolveReference: RichMenuReferenceResolver;
}
