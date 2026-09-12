import type { HqTemplateAdapter, HqTemplateType } from './contract.js';
import { formHqTemplateAdapter } from './form.js';
import { richMenuHqTemplateAdapter } from './rich-menu.js';
import { tagHqTemplateAdapter } from './tag.js';
import { templateHqTemplateAdapter } from './template.js';

export type HqTemplateAdapterRegistry = Readonly<Record<HqTemplateType, HqTemplateAdapter>>;

export const hqTemplateAdapterRegistry: HqTemplateAdapterRegistry = Object.freeze({
  tag: tagHqTemplateAdapter,
  template: templateHqTemplateAdapter,
  rich_menu: richMenuHqTemplateAdapter,
  form: formHqTemplateAdapter,
});

export function getHqTemplateAdapter(type: HqTemplateType): HqTemplateAdapter {
  return hqTemplateAdapterRegistry[type];
}
