import type { BannerGeneration } from '@line-crm/db';
import type { BannerRequestValidation } from './banner-prompt.js';
type Request = NonNullable<BannerRequestValidation['value']>;

export async function bannerGenerationOperationId(tenantId: string, projectId: string, key: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['banner-generation', tenantId, projectId, key])));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Compare only immutable caller choices. Quota, engine settings and references may change after success. */
export function bannerGenerationRequestMatches(row: BannerGeneration, request: Request): boolean {
  const stored = [row.mode, row.preset_key, JSON.parse(row.text_lines), JSON.parse(row.emphasis_lines ?? '[]'),
    row.base_color, row.main_color, row.sub_color, row.accent_color, row.person_option,
    row.custom_prompt, row.free_prompt, row.requested_count, JSON.parse(row.reference_images ?? '[]')];
  const incoming = [request.mode, request.preset.key, request.textLines, request.emphasisLines,
    request.baseColor, request.mainColor, request.subColor, request.accentColor, request.personOption,
    request.customPrompt, request.freePrompt, request.count, request.references];
  return JSON.stringify(stored) === JSON.stringify(incoming);
}
