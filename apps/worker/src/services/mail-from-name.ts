/**
 * musubo と然-NEN-はメールの送信経路を共有するため、件名のブランドから差出人名を選び、取り違えを防ぐ。
 * 中継と SMTP の両方へ同じ判定を適用し、中継側も許可された2つの名前以外は既定値へ戻す。自由な差出人名は受け付けない。
 */

/** ペットフードの 然-NEN- 側の窓口名。中継の既定値と同じ。 */
export const NEN_FROM_NAME = '然-NEN- お客様窓口';

/**
 * SaaS の案内を別ブランドと取り違えないよう、musubo の差出人名を使う。
 */
export const MUSUBO_FROM_NAME = 'musubo';

export function mailFromName(subject: string): string {
  return subject.startsWith('【musubo') ? MUSUBO_FROM_NAME : NEN_FROM_NAME;
}
