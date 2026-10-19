import { type HqSupportKind, type HqSupportRequest, formatTicketNo } from '@line-crm/db';


export const HQ_SUPPORT_KIND_LABELS: Record<HqSupportKind, string> = {
  usage: '使い方について',
  bug: '不具合の報告',
  billing: '料金・契約について',
  feature: '要望・提案',
  other: 'その他',
};

export type ReplyView = { id: string; authorName: string; body: string; createdAt: string };

export function serialize(row: HqSupportRequest, base: string, replies: ReplyView[] = []) {
  let keys: string[] = [];
  try {
    const parsed = JSON.parse(row.attachment_keys) as unknown;
    keys = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    keys = [];
  }
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: HQ_SUPPORT_KIND_LABELS[row.kind] ?? row.kind,
    subject: row.subject,
    body: row.body,
    lineAccountId: row.line_account_id,
    attachments: keys.map((key) => ({ key, url: `${base}/images/${key}` })),
    status: row.status,
    staffName: row.staff_name,
    notified: row.notified_at !== null,
    createdAt: row.created_at,
    // 運営側のチケット番号と返信（★37-6 の返信は統括の履歴にも載る）
    ticketLabel: formatTicketNo(row.ticket_no ?? null),
    stage: row.stage,
    replies,
  };
}
