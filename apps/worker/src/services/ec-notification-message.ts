import type { Message } from '@line-crm/line-sdk';
import type { EcEvent } from '../routes/ec-integrations.js';

export type EcNotificationCopy = {
  title?: string | null;
  introText?: string | null;
  outroText?: string | null;
  buttonLabel?: string | null;
  buttonUrl?: string | null;
  imageUrl?: string | null;
  test?: boolean;
};

const BANK_DETAILS = [
  ['金融機関', 'GMOあおぞらネット銀行（0310）'],
  ['支店', '法人第二営業部（102）'],
  ['口座', '普通 1664636'],
  ['名義', 'シェッドプロダクツ（カ'],
] as const;

function yen(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `¥${Math.round(value).toLocaleString('ja-JP')}`
    : '—';
}

function itemText(event: EcEvent): string {
  const items = event.order?.items ?? event.subscription?.items ?? [];
  const visible = items.slice(0, 3).map((item) => `${item.name} × ${item.quantity}`);
  if (items.length > visible.length) visible.push(`ほか${items.length - visible.length}点`);
  return visible.join('\n');
}

function isBankTransfer(event: EcEvent): boolean {
  return event.event_type === 'ec.order.bank_transfer_reminder'
    || (event.event_type === 'ec.order.confirmed'
      && /銀行|振込/.test(event.order?.payment_method || ''));
}

function details(event: EcEvent): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (event.order?.number) rows.push(['注文番号', event.order.number]);

  if (event.event_type === 'ec.order.confirmed') {
    const items = itemText(event);
    if (items) rows.push(['商品', items]);
    if (typeof event.order?.total === 'number') rows.push(['合計', yen(event.order.total)]);
    if (event.order?.delivery_date) rows.push(['お届け予定', `${event.order.delivery_date}${event.order.delivery_time ? ` ${event.order.delivery_time}` : ''}`]);
  }
  if (event.event_type === 'ec.order.payment_received' && typeof event.order?.total === 'number') {
    rows.push(['入金額', yen(event.order.total)]);
  }
  if (event.event_type === 'ec.order.bank_transfer_reminder' && event.order?.payment_deadline) {
    rows.push(['お振込期限', event.order.payment_deadline]);
  }
  if (event.event_type === 'ec.order.shipped') {
    const items = itemText(event);
    if (items) rows.push(['商品', items]);
    if (event.shipping?.carrier) rows.push(['配送会社', event.shipping.carrier]);
    if (event.shipping?.tracking_number) rows.push(['送り状番号', event.shipping.tracking_number]);
  }
  if (event.event_type === 'ec.order.refunded' && event.refund?.amount != null) {
    rows.push(['返金額', yen(event.refund.amount)]);
  }
  if (event.event_type.startsWith('ec.subscription.')) {
    if (event.subscription?.contract_number) rows.push(['定期便番号', event.subscription.contract_number]);
    if (event.subscription?.next_order_date) rows.push(['次回確定日', event.subscription.next_order_date]);
    if (event.subscription?.change_deadline) rows.push(['変更期限', event.subscription.change_deadline]);
    const items = itemText(event);
    if (items) rows.push(['商品', items]);
    if (event.subscription?.scheduled_shipping_date) rows.push(['発送予定日', event.subscription.scheduled_shipping_date]);
    if (event.subscription?.amount != null) rows.push(['お支払い金額', yen(event.subscription.amount)]);
    if (event.subscription?.retry_status) rows.push(['再決済結果', event.subscription.retry_status]);
  }
  if (isBankTransfer(event)) rows.push(...BANK_DETAILS.map((row) => [row[0], row[1]] as [string, string]));
  return rows;
}

function defaultTitle(eventType: string): string {
  return ({
    'ec.order.confirmed': 'ご注文ありがとうございます',
    'ec.order.payment_received': 'ご入金を確認いたしました',
    'ec.order.bank_transfer_reminder': '銀行振込期限のご案内',
    'ec.order.shipped': '商品を発送しました',
    'ec.order.cancelled': 'ご注文のキャンセルを承りました',
    'ec.order.refunded': '返金手続きが完了しました',
    'ec.subscription.upcoming': '次回の定期便をお知らせします',
    'ec.subscription.payment_failed': '定期便のお支払いをご確認ください',
    'ec.subscription.card_updated': 'カード変更・再決済結果のご案内',
    'ec.subscription.cancelled': '定期便の解約を受け付けました',
  } as Record<string, string>)[eventType] || '然-NEN-からのお知らせ';
}

function destination(event: EcEvent, copy: EcNotificationCopy): string {
  return copy.buttonUrl
    || event.shipping?.tracking_url
    || event.subscription?.payment_method_update_url
    || event.subscription?.mypage_subscription_url
    || event.subscription?.manage_url
    || event.order?.detail_url
    || '';
}

export function ecFlexMessage(event: EcEvent, copy: EcNotificationCopy = {}): Message {
  const title = (copy.title || defaultTitle(event.event_type)).trim();
  const rows = details(event);
  const url = destination(event, copy);
  const bodyContents: Array<Record<string, unknown>> = [
    {
      type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm',
      contents: [
        { type: 'text', text: '然', size: 'lg', weight: 'bold', color: '#B08D57', flex: 0 },
        { type: 'text', text: 'NEN', size: 'xs', weight: 'bold', color: '#1B3A31', letterSpacing: '0.16em', flex: 0 },
        { type: 'separator', color: '#D8C7A8' },
        ...(copy.test ? [{ type: 'text', text: 'TEST', size: 'xxs', weight: 'bold', color: '#9A6B2F', flex: 0 }] : []),
      ],
    },
    { type: 'text', text: title, size: 'xl', weight: 'bold', color: '#1B3A31', wrap: true, margin: 'lg' },
  ];
  if (copy.introText?.trim()) {
    bodyContents.push({ type: 'text', text: copy.introText.trim(), size: 'sm', color: '#4B5B55', wrap: true, margin: 'md', lineSpacing: '5px' });
  }
  if (rows.length) {
    bodyContents.push({ type: 'separator', color: '#E6DED0', margin: 'lg' });
    bodyContents.push({
      type: 'box', layout: 'vertical', spacing: 'md', margin: 'lg',
      contents: rows.map(([label, value]) => ({
        type: 'box', layout: 'vertical', spacing: 'xs',
        contents: [
          { type: 'text', text: label, size: 'xxs', weight: 'bold', color: '#9A8060' },
          { type: 'text', text: value, size: 'sm', color: '#25352F', wrap: true },
        ],
      })),
    });
  }
  if (copy.outroText?.trim()) {
    bodyContents.push({ type: 'text', text: copy.outroText.trim(), size: 'xs', color: '#6E7773', wrap: true, margin: 'lg', lineSpacing: '4px' });
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble', size: 'kilo',
    ...(copy.imageUrl ? {
      hero: { type: 'image', url: copy.imageUrl, size: 'full', aspectRatio: '20:9', aspectMode: 'cover' },
    } : {}),
    body: {
      type: 'box', layout: 'vertical', backgroundColor: '#FBF8F1', paddingAll: '22px',
      contents: bodyContents,
    },
    ...(url && copy.buttonLabel ? {
      footer: {
        type: 'box', layout: 'vertical', backgroundColor: '#FBF8F1', paddingAll: '18px', paddingTop: '0px',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: '#1B3A31',
          action: { type: 'uri', label: copy.buttonLabel.slice(0, 20), uri: url },
        }],
      },
    } : {}),
  };
  return { type: 'flex', altText: `${copy.test ? '【テスト】' : ''}${title}`.slice(0, 400), contents: bubble } as Message;
}
