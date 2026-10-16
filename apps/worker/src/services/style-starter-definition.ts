import { templateSamples } from './style-template-samples.js';

import { type AccountStyle, type StyleCard } from '@line-crm/shared';

import { StyleError, features, defaultCards, readCards } from './style-setup-core.js';
export type StarterItem = {
  key: string;
  kind: 'template' | 'rich_menu' | 'automation' | 'booking_menu' | 'dashboard';
  name: string;
  feature?: string;
  text?: string;
  durationMinutes?: number;
  price?: number;
  buttons?: Array<{ label: string; feature: string }>;
  cards?: StyleCard[];
  sourceId?: string;
};
export type StarterDefinition = { items: StarterItem[] };
export function standardStarter(style: AccountStyle): StarterDefinition {
  const names: Record<AccountStyle, string> = {
    standard: 'ご案内',
    ec: 'お買い物',
    restaurant: 'お店',
    salon: 'サロン',
    consult: 'ご相談',
    lesson: 'レッスン',
  };
  return {
    items: [
      {
        key: 'welcome',
        kind: 'template',
        name: `${names[style]}のごあいさつ`,
        text: `こんにちは。${names[style]}へのお問い合わせありがとうございます。ご希望をお知らせください。`,
      },
      {
        key: 'menu',
        kind: 'rich_menu',
        name: `${names[style]}のメニュー`,
        buttons: [
          { label: '予約する', feature: 'booking' },
          { label: 'ポイントカード', feature: 'stamps' },
          { label: 'お問い合わせ', feature: 'contact' },
        ],
      },
      {
        key: 'booking',
        kind: 'booking_menu',
        feature: 'booking',
        name: `${names[style]}の予約`,
        durationMinutes: 60,
        price: 0,
      },
      {
        key: 'reminder',
        kind: 'automation',
        feature: 'reminders',
        name: '予約確定のご案内',
        text: 'ご予約ありがとうございます。日時をご確認ください。',
      },
      {
        key: 'dashboard',
        kind: 'dashboard',
        name: 'ダッシュボードの型',
        cards: defaultCards(style),
      },
      ...templateSamples(style).map((sample) => sample.starterItem),
    ],
  };
}
export function readDefinition(
  value: unknown,
  style: AccountStyle,
): StarterDefinition {
  const input = value as StarterDefinition;
  if (!input || !Array.isArray(input.items) || input.items.length > 30)
    throw new StyleError('invalid_starter_set');
  const seen = new Set<string>();
  for (const item of input.items) {
    if (
      !item ||
      typeof item.key !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(item.key) ||
      seen.has(item.key) ||
      ![
        'template',
        'rich_menu',
        'automation',
        'booking_menu',
        'dashboard',
      ].includes(item.kind) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 100 ||
      (item.feature && !Object.hasOwn(features, item.feature)) ||
      (item.text !== undefined &&
        (typeof item.text !== 'string' || item.text.length > 2000)) ||
      (item.durationMinutes !== undefined &&
        (!Number.isInteger(item.durationMinutes) ||
          item.durationMinutes < 5 ||
          item.durationMinutes > 1440)) ||
      (item.price !== undefined &&
        (!Number.isInteger(item.price) || item.price < 0)) ||
      (item.sourceId !== undefined && typeof item.sourceId !== 'string')
    )
      throw new StyleError('invalid_starter_set');
    if (
      item.buttons &&
      (!Array.isArray(item.buttons) ||
        item.buttons.length > 6 ||
        item.buttons.some(
          (b) =>
            typeof b.label !== 'string' ||
            b.label.length > 50 ||
            (!Object.hasOwn(features, b.feature) && b.feature !== 'contact'),
        ))
    )
      throw new StyleError('invalid_buttons');
    if (item.cards) readCards(item.cards, style);
    seen.add(item.key);
  }
  return input;
}
