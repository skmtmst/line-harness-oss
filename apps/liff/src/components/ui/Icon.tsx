// Lucide (ISC License, https://lucide.dev) の線アイコンを写した小さな部品。
// 使う分だけ path を持つ。依存は増やさない (package.json・lockfile 不変)。
// 見た目は 24x24・線・角丸 (lucide の決まり) でそろえる。絵文字は使わない。

const PATHS = {
  /** 済み・選択中 */
  check: [<path key="c" d="M20 6 9 17l-5-5" />],
  /** 戻る */
  'chevron-left': [<path key="c" d="m15 18-6-6 6-6" />],
  /** 次へ */
  'chevron-right': [<path key="c" d="m9 18 6-6-6-6" />],
  /** 日付・空き */
  calendar: [
    <rect key="r" width="18" height="18" x="3" y="4" rx="2" />,
    <path key="a" d="M16 2v4" />,
    <path key="b" d="M8 2v4" />,
    <path key="c" d="M3 10h18" />,
  ],
  /** 予約の履歴を見る */
  'calendar-days': [
    <path key="a" d="M8 2v4" />,
    <path key="b" d="M16 2v4" />,
    <rect key="r" width="18" height="18" x="3" y="4" rx="2" />,
    <path key="c" d="M3 10h18" />,
    <path key="d" d="M8 14h.01" />,
    <path key="e" d="M12 14h.01" />,
    <path key="f" d="M16 14h.01" />,
    <path key="g" d="M8 18h.01" />,
    <path key="h" d="M12 18h.01" />,
    <path key="i" d="M16 18h.01" />,
  ],
  /** 時刻 */
  clock: [
    <circle key="c" cx="12" cy="12" r="10" />,
    <path key="h" d="M12 6v6l4 2" />,
  ],
  /** 案内の帯の印 */
  info: [
    <circle key="c" cx="12" cy="12" r="10" />,
    <path key="a" d="M12 16v-4" />,
    <path key="b" d="M12 8h.01" />,
  ],
  /** 送信した */
  send: [
    <path
      key="a"
      d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"
    />,
    <path key="b" d="m21.854 2.147-10.94 10.939" />,
  ],
  /** 読み込み直し */
  'rotate-cw': [
    <path key="a" d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />,
    <path key="b" d="M21 3v5h-5" />,
  ],
  /** 読み込めなかった時の印 (雲＋斜線) */
  'cloud-off': [
    <path key="a" d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
    <path key="b" d="m2 2 20 20" />,
  ],
  /** お店への連絡の案内 */
  'message-circle': [<path key="a" d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />],
  /** 担当 (1人) */
  user: [
    <path key="a" d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />,
    <circle key="c" cx="12" cy="7" r="4" />,
  ],
  /** 指名なし (複数人) */
  users: [
    <path key="a" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />,
    <circle key="b" cx="9" cy="7" r="4" />,
    <path key="c" d="M22 21v-2a4 4 0 0 0-3-3.87" />,
    <path key="d" d="M16 3.13a4 4 0 0 1 0 7.75" />,
  ],
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
