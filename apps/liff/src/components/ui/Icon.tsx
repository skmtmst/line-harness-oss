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
  /** 一覧（リスト表示の切り替え・自分のイベントへ戻る。lucide list と同じ線） */
  list: [
    <path key="a" d="M3 12h.01" />,
    <path key="b" d="M3 18h.01" />,
    <path key="c" d="M3 6h.01" />,
    <path key="d" d="M8 12h13" />,
    <path key="e" d="M8 18h13" />,
    <path key="f" d="M8 6h13" />,
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
  /** 画像が無いときの印 (イベント詳細) */
  image: [
    <rect key="r" width="18" height="18" x="3" y="3" rx="2" />,
    <circle key="c" cx="9" cy="9" r="2" />,
    <path key="p" d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />,
  ],
  /** 場所 (イベント詳細) */
  'map-pin': [
    <path key="p" d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />,
    <circle key="c" cx="12" cy="10" r="3" />,
  ],
  /** 待ち (キャンセル待ち・承認待ちの印) */
  hourglass: [
    <path key="a" d="M5 22h14" />,
    <path key="b" d="M5 2h14" />,
    <path key="c" d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12 7.586 16.414A2 2 0 0 0 7 17.828V22" />,
    <path key="d" d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />,
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
  /** 取り消せない操作の確認窓の印 (警告の三角) */
  'alert-triangle': [
    <path
      key="a"
      d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
    />,
    <path key="b" d="M12 9v4" />,
    <path key="c" d="M12 17h.01" />,
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
  /** 友だち追加のお願い */
  'user-plus': [
    <path key="a" d="M2 21a8 8 0 0 1 13.292-6" />,
    <circle key="b" cx="10" cy="8" r="5" />,
    <path key="c" d="M19 16v6" />,
    <path key="d" d="M22 19h-6" />,
  ],
  /** 送信した・配信が終わった */
  'circle-check': [<circle key="c" cx="12" cy="12" r="10" />, <path key="p" d="m9 12 2 2 4-4" />],
  /** 紹介リンクの写し */
  copy: [
    <rect key="r" width="14" height="14" x="8" y="8" rx="2" />,
    <path
      key="p"
      d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
    />,
  ],
  /** 紹介リンクの印 */
  link: [
    <path
      key="a"
      d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
    />,
    <path
      key="b"
      d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
    />,
  ],
  /** リンクの発行 */
  plus: [<path key="a" d="M5 12h14" />, <path key="b" d="M12 5v14" />],
  /** 紹介ではじめる */
  'share-2': [
    <circle key="a" cx="18" cy="5" r="3" />,
    <circle key="b" cx="6" cy="12" r="3" />,
    <circle key="c" cx="18" cy="19" r="3" />,
    <line key="d" x1="8.59" x2="15.42" y1="13.51" y2="17.49" />,
    <line key="e" x1="15.41" x2="8.59" y1="6.51" y2="10.49" />,
  ],
  /** タップで音声を出す */
  'volume-x': [
    <path
      key="a"
      d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"
    />,
    <line key="b" x1="22" x2="16" y1="9" y2="15" />,
    <line key="c" x1="16" x2="22" y1="9" y2="15" />,
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
