/**
 * 対応マーク。
 *
 * 受信箱の「未対応／対応中／解決済」は chats.status が持っているが、
 * あれは3つ固定でトークにしか付かない。マークは友だちに付き、
 * 名前も色も運用側が決められる。
 */

export type { SupportMark } from './support-mark-types.js';
import type { SupportMark } from './support-mark-types.js';

export interface SupportMarkWithUsage extends SupportMark {
  friend_count: number;
  broadcasts: number;
  scenarios: number;
  auto_replies: number;
  saved_searches: number;
  automations: number;
}

export function supportMarkImpactRevision(mark: SupportMarkWithUsage): string {
  return [
    mark.id,
    Number(mark.version ?? 1),
    Number(mark.friend_count),
    Number(mark.broadcasts),
    Number(mark.scenarios),
    Number(mark.auto_replies),
    Number(mark.saved_searches),
    Number(mark.automations),
  ].join(':');
}
