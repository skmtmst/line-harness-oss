import { templateSamples } from './style-template-samples.js';

import { type AccountStyle, type StyleCard } from '@line-crm/shared';

import {
  StyleError,
  features,
  defaultCards,
  readCards,
} from './style-setup-core.js';
export type StarterItem = {
  key: string;
  kind:
    | 'template'
    | 'rich_menu'
    | 'automation'
    | 'reminder'
    | 'booking_menu'
    | 'dashboard';
  name: string;
  feature?: string;
  text?: string;
  durationMinutes?: number;
  price?: number;
  buttons?: Array<{ label: string; feature: string }>;
  cards?: StyleCard[];
  sourceId?: string;
  offsetMinutes?: number;
  offsetDays?: number;
  sendAtTime?: string;
  triggerType?: 'calendar_booked' | 'restaurant.departed';
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
          ...(!['standard', 'ec'].includes(style)
            ? [
                {
                  label: style === 'lesson' ? 'クラスを予約する' : '予約する',
                  feature: 'booking',
                },
              ]
            : []),
          ...(['restaurant', 'salon', 'lesson'].includes(style)
            ? [{ label: 'ポイントカード', feature: 'stamps' }]
            : []),
          { label: 'お問い合わせ', feature: 'contact' },
        ],
      },
      ...(['salon', 'consult'].includes(style)
        ? [
            {
              key: 'booking',
              kind: 'booking_menu' as const,
              feature: 'booking',
              name: `${names[style]}の予約`,
              durationMinutes: 60,
              price: 0,
            },
          ]
        : []),
      ...(style === 'restaurant'
        ? [
            {
              key: 'reminder-thanks',
              kind: 'automation' as const,
              feature: 'reminders',
              name: '来店のお礼',
              text: 'ご来店ありがとうございました。またのお越しをお待ちしています。',
              triggerType: 'restaurant.departed' as const,
            },
          ]
        : []),
      ...(['salon', 'consult', 'lesson'].includes(style)
        ? [
            {
              key: 'reminder-day-before',
              kind: 'reminder' as const,
              feature: 'reminders',
              name: '前日のリマインド',
              offsetMinutes: -1440,
              offsetDays: -1,
              sendAtTime: '18:00',
              text: '明日のご予約についてご案内します。お会いできるのを楽しみにしています。',
            },
            {
              key: 'reminder-today',
              kind: 'reminder' as const,
              feature: 'reminders',
              name: '当日のご案内',
              offsetMinutes: -120,
              text: '本日のご予約についてご案内します。お気をつけてお越しください。',
            },
            {
              key: 'reminder-thanks',
              kind: 'reminder' as const,
              feature: 'reminders',
              name: '来店のお礼',
              offsetMinutes: 1440,
              offsetDays: 1,
              sendAtTime: '12:00',
              text: '昨日はありがとうございました。またのお越しをお待ちしています。',
            },
          ]
        : []),
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
        'reminder',
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
      (item.triggerType !== undefined &&
        !['calendar_booked', 'restaurant.departed'].includes(
          item.triggerType,
        )) ||
      (item.offsetDays !== undefined &&
        (!Number.isInteger(item.offsetDays) ||
          Math.abs(item.offsetDays) > 30)) ||
      (item.sendAtTime !== undefined &&
        (typeof item.sendAtTime !== 'string' ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.sendAtTime))) ||
      (item.offsetMinutes !== undefined &&
        (!Number.isInteger(item.offsetMinutes) ||
          Math.abs(item.offsetMinutes) > 43200)) ||
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
  if (
    input.items.some(
      (i) =>
        i.kind === 'automation' &&
        (i.triggerType !== 'restaurant.departed' ||
          i.key === 'reminder' ||
          /予約確定/.test(i.name)),
    )
  )
    throw new StyleError('duplicate_confirmation_automation', 422);
  return input;
}
