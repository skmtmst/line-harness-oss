import styles from './badge.module.css';
/**
 * ★V8 の札。状態は色だけにせず文字を出す。
 * confirmed=確定 (緑)・pending=確認待ち (黄)・info=お店で払う (青)・neutral=それ以外 (灰)。
 */
export default function Badge({
  tone,
  children,
  withDot = false,
  size = 'sm',
}: {
  tone: 'confirmed' | 'pending' | 'info' | 'neutral';
  children: string;
  withDot?: boolean;
  /** md は予約の履歴の支払いの札（nWby5）。高さ22・文字12。 */
  size?: 'sm' | 'md';
}) {
  const cls =
    tone === 'confirmed'
      ? 'bg-liff-ok-bg text-liff-ok-ink'
      : tone === 'pending'
        ? 'bg-liff-wait-bg text-liff-wait-ink'
        : tone === 'info'
          ? 'bg-info-bg text-info-link'
          : 'bg-liff-chip text-liff-sub';
  return (
    <span
      className={withDot && tone === 'pending' ? styles.pending : `inline-block h-fit w-fit shrink-0 rounded-full font-bold whitespace-nowrap ${size === 'md' ? 'px-2.5 py-[3px] text-xs' : 'px-2 py-0.5 text-[10.5px]'} ${cls}`}
    >
      {withDot && tone === 'pending' ? <span className={styles.dot} aria-hidden="true" data-liff-badge-dot /> : null}
      {children}
    </span>
  );
}
