import {createBookingMenuHqAdapter} from './catalog.js';
import { unsupportedHqTemplateAdapter } from './contract.js';
import type { HqTemplateAdapter, HqTemplateAuthority } from './contract.js';
import type { HqTemplateType } from '@line-crm/db';
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
  scenario: unsupportedHqTemplateAdapter('scenario'),
  friend_field: unsupportedHqTemplateAdapter('friend_field'),
  mark: unsupportedHqTemplateAdapter('mark'),
  auto_reply: unsupportedHqTemplateAdapter('auto_reply'),
  friend_add_rule: unsupportedHqTemplateAdapter('friend_add_rule'),
  reminder: unsupportedHqTemplateAdapter('reminder'),
  booking_menu: unsupportedHqTemplateAdapter('booking_menu'),
  mileage_reward: unsupportedHqTemplateAdapter('mileage_reward'),
});

export function getHqTemplateAdapter(type: HqTemplateType, binding?: { db: D1Database; authority: HqTemplateAuthority }): HqTemplateAdapter {
  if(type==='booking_menu'&&binding)return createBookingMenuHqAdapter(binding.db,binding.authority);
  if (type === 'tag' && binding) return createTagHqTemplateAdapter(binding.db, binding.authority);
  return hqTemplateAdapterRegistry[type];
}
