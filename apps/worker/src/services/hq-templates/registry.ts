import type { HqTemplateAdapter, HqTemplateType, HqTemplateAuthority } from './contract.js';
import { formHqTemplateAdapter } from './form.js';
import { richMenuHqTemplateAdapter } from './rich-menu.js';
import { tagHqTemplateAdapter, createTagHqTemplateAdapter } from './tag.js';
import { templateHqTemplateAdapter } from './template.js';

export type HqTemplateAdapterRegistry = Readonly<Record<HqTemplateType, HqTemplateAdapter>>;

export const hqTemplateAdapterRegistry: HqTemplateAdapterRegistry = Object.freeze({
  tag: tagHqTemplateAdapter,
  template: templateHqTemplateAdapter,
  rich_menu: richMenuHqTemplateAdapter,
  form: formHqTemplateAdapter,
});

export function getHqTemplateAdapter(type: HqTemplateType, binding?: { db: D1Database; authority: HqTemplateAuthority }): HqTemplateAdapter {
  if (type === 'tag' && binding) return createTagHqTemplateAdapter(binding.db, binding.authority);
  return hqTemplateAdapterRegistry[type];
}
