/**
 * musubo と然-NEN-はメールの送信経路を共有するため、明示的な然の件名だけ専用差出人を使う。
 * 中継と SMTP の両方へ同じ判定を適用し、中継側も許可された2つの名前以外は既定値へ戻す。自由な差出人名は受け付けない。
 */

/** ペットフードの 然-NEN- 側の窓口名。中継の既定値と同じ。 */
export const NEN_FROM_NAME = '然-NEN- お客様窓口';

/**
 * 共通通知を別ブランドと取り違えないよう、既定の差出人名は musubo にする。
 */
export const MUSUBO_FROM_NAME = 'musubo';

export function mailFromName(subject: string): string {
  return subject.startsWith('【然-NEN-') ? NEN_FROM_NAME : MUSUBO_FROM_NAME;
}
