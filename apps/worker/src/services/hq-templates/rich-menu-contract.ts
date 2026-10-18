import type { HqTemplateAuthority,HqTemplateAdapterInput,HqTemplateReference } from './contract.js';
export interface RichMenuReferenceResolver {
  (reference: HqTemplateReference, targetAccountId: string): Promise<string | null | { targetId: string; operation: 'reuse' | 'create'; expectedRevision?: string }>;
}

export interface RichMenuAdapterOptions {
  db: D1Database; bucket: Pick<R2Bucket, 'head' | 'get' | 'put' | 'delete'>;
  authority: HqTemplateAuthority;
  /** A factory is bound to one immutable version; never reuse it for another template. */
  input: HqTemplateAdapterInput;
  resolveReference: RichMenuReferenceResolver;
}
