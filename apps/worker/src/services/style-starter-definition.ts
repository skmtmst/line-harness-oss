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
  buttons?: Array<{ label: string; feature: string; actionType?: 'uri' | 'message'; actionData?: string }>;
  cards?: StyleCard[];
  sourceId?: string;
  offsetMinutes?: number;
  offsetDays?: number;
  sendAtTime?: string;
  triggerType?: 'calendar_booked' | 'restaurant.departed';
};
export function isCustomerUri(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
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
        text: style === 'ec' ? '友だち追加ありがとうございます。商品やご利用ガイドは、下のメニューからご覧いただけます。' : style === 'standard' ? '友だち追加ありがとうございます。お知らせ・お申し込み・お問い合わせは、下のメニューからご確認いただけます。' : style === 'consult' ? '友だち追加ありがとうございます。面談のご予約・資料は、下のメニューからご確認いただけます。' : `こんにちは。${names[style]}へのお問い合わせありがとうございます。ご希望をお知らせください。`,
      },
      {
        key: 'menu',
        kind: 'rich_menu',
        name: `${names[style]}のメニュー`,
        buttons: style === 'restaurant' ? [
          ...(!['standard', 'ec'].includes(style)
            ? [
                {
                  label: '予約する',
                  feature: 'booking',
                },
              ]
            : []),
          ...(['restaurant', 'salon', 'lesson'].includes(style)
            ? [{ label: 'ポイントカード', feature: 'stamps' }]
            : []),
          { label: 'お問い合わせ', feature: 'contact' },
        ] : style === 'ec' ? [
          { label: '商品を見る', feature: 'content' },
          { label: 'お買い物を続ける', feature: 'content' },
          { label: 'マイページ', feature: 'tickets' },
          { label: 'クーポン', feature: 'coupons' },
          { label: 'ご利用ガイド', feature: 'content' },
          { label: 'お問い合わせ', feature: 'contact' },
        ] : style === 'standard' ? [
          { label: 'お知らせ', feature: 'content' },
          { label: 'お申し込み', feature: 'content' },
          { label: 'よくある質問', feature: 'content' },
          { label: 'ご利用ガイド', feature: 'content' },
          { label: 'マイページ', feature: 'tickets' },
          { label: 'お問い合わせ', feature: 'contact' },
        ] : [
          { label: style === 'lesson' ? 'クラスを予約する' : style === 'consult' ? '面談を予約する' : '予約する', feature: 'booking' },
          { label: '予約の確認', feature: 'booking', actionData: 'history' },
          ...(style === 'consult' ? [{ label: '資料', feature: 'content' }, { label: 'よくある質問', feature: 'content' }, { label: '会社のこと', feature: 'content' }] : [
            { label: '回数券', feature: 'tickets' },
            { label: style === 'lesson' ? 'スケジュール' : 'スタイル写真', feature: style === 'lesson' ? 'classCapacity' : 'content' },
            { label: style === 'lesson' ? '振替' : 'スタンプ', feature: style === 'lesson' ? 'classCapacity' : 'stamps', ...(style === 'lesson' ? { actionData: 'history' } : {}) },
          ]),
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
              name: style === 'consult' ? '面談の前日の案内' : style === 'lesson' ? 'クラスの前日の案内' : '前日のリマインド',
              offsetMinutes: -1440,
              offsetDays: -1,
              sendAtTime: '18:00',
              text: style === 'consult' ? '明日の面談についてご案内します。会い方・場所は予約の内容をご確認ください。' : style === 'lesson' ? '明日のクラスについてご案内します。参加方法は申込内容をご確認ください。' : '明日のご予約についてご案内します。お会いできるのを楽しみにしています。',
            },
            {
              key: 'reminder-today',
              kind: 'reminder' as const,
              feature: 'reminders',
              name: '当日のご案内',
              offsetMinutes: -120,
              text: style === 'consult' ? '本日の面談についてご案内します。会い方・場所は予約の内容をご確認ください。' : style === 'lesson' ? '本日のクラスについてご案内します。参加方法は申込内容をご確認ください。' : '本日のご予約についてご案内します。お気をつけてお越しください。',
            },
            {
              key: 'reminder-thanks',
              kind: 'reminder' as const,
              feature: 'reminders',
              name: style === 'consult' ? '面談のお礼' : style === 'lesson' ? '参加のお礼' : '来店のお礼',
              offsetMinutes: 1440,
              offsetDays: 1,
              sendAtTime: '12:00',
              text: style === 'consult' || style === 'lesson' ? '昨日はご参加ありがとうございました。ご質問がありましたら、このトークでお知らせください。' : '昨日はありがとうございました。またのお越しをお待ちしています。',
            },
          ]
        : []),
      {
        key: 'dashboard',
        kind: 'dashboard',
        name: 'ダッシュボードの型',
        cards: defaultCards(style),
      },
      ...templateSamples(style).filter(sample => !['standard', 'ec'].includes(style) || (style === 'ec' ? ['new-item', 'purchase-thanks', 'restock', 'inquiry-received'] : ['new-item', 'inquiry-received', 'hours-change', 'birthday']).includes(sample.key)).map((sample) => sample.starterItem),
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
            (!Object.hasOwn(features, b.feature) && b.feature !== 'contact') ||
            (b.actionType !== undefined && !['uri', 'message'].includes(b.actionType)) ||
            (b.actionData !== undefined && (typeof b.actionData !== 'string' || b.actionData.length > 2000)) ||
            (b.actionType === 'uri' && !isCustomerUri(b.actionData)),
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
