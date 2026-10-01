/**
 * メールの差出人の表示名（From の「〜」の部分）を決める。
 *
 * musubo（管理画面の SaaS）と 然-NEN-（ペットフード）は、同じ Xserver の
 * 送信経路を共有している。表示名を1つに固定していたため、musubo の会員登録
 * メールが「然-NEN- お客様窓口」から届いていた（2026-09-30 指摘）。
 *
 * 件名はすでに【musubo】【然-NEN-】で分かれているので、そこだけを判断材料に
 * して取り違えを防ぐ。ここを直せば送信経路（中継／SMTP）の両方に効く。
 *
 * 中継（PHP）側にも同じ2つの名前だけを許可する一覧があり、それ以外の名前が
 * 来たら既定値に落とす。差出人名を自由に書けるようにはしない。
 */

/** ペットフードの 然-NEN- 側の窓口名。中継の既定値と同じ。 */
export const NEN_FROM_NAME = '然-NEN- お客様窓口';

/** SaaS の musubo 側の差出人名（決定 2026-09-30）。 */
export const MUSUBO_FROM_NAME = 'musubo';

export function mailFromName(subject: string): string {
  return subject.startsWith('【musubo') ? MUSUBO_FROM_NAME : NEN_FROM_NAME;
}
