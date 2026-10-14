import styles from './Badge.module.css';
/**
 * ★V8 の札。状態は色だけにせず文字を出す。
 * confirmed=確定 (緑)・pending=確認待ち (黄)・neutral=それ以外 (灰)。
 */
export default function Badge({
  tone,
  children,
  withDot = false,
}: {
  tone: 'confirmed' | 'pending' | 'neutral';
  children: string;
  withDot?: boolean;
}) {
  const cls =
    tone === 'confirmed'
      ? 'bg-liff-ok-bg text-liff-ok-ink'
      : tone === 'pending'
        ? 'bg-liff-wait-bg text-liff-wait-ink'
        : 'bg-liff-chip text-liff-sub';
  return (
    <span
      className={withDot && tone === 'pending' ? styles.pending : `inline-block h-fit w-fit shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap ${cls}`}
    >
      {withDot && tone === 'pending' ? <span className={styles.dot} aria-hidden="true" data-liff-badge-dot /> : null}
      {children}
    </span>
  );
}
