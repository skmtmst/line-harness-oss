import { HqTemplateError } from './tag.js'
import { HqR2RuntimeError } from './runtime-r2.js'
export function rethrowR2(error: unknown): never {
  if (!(error instanceof HqR2RuntimeError)) throw error;
  if (error.code === 'DISPLAY_TAG_UNAVAILABLE') throw new HqTemplateError('DISPLAY_TAG_UNAVAILABLE', 409);
  if (error.code === 'LIFF_UNAVAILABLE') throw new HqTemplateError('LIFF_UNAVAILABLE', 409);
  if (error.code === 'CARD_REFERENCE_UNAVAILABLE') throw new HqTemplateError('CARD_REFERENCE_UNAVAILABLE', 409);
  if (error.code === 'FORBIDDEN') throw new HqTemplateError('FORBIDDEN', 403);
  if (error.code === 'VERSION_CONFLICT' || error.code.includes('UNAVAILABLE') || error.code.startsWith('AMBIGUOUS_')) throw new HqTemplateError('VERSION_CONFLICT', 409);
  if (error.code.includes('UNSUPPORTED')) throw new HqTemplateError('UNSUPPORTED', 422);
  throw new HqTemplateError('INVALID_DEFINITION');
}
