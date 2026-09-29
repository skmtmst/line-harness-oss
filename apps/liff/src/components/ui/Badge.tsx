/**
 * ★V7 の札。状態は色だけにせず文字を出す。
 * confirmed=確定 (緑)・pending=確認待ち (黄)・neutral=それ以外 (灰)。
 */
export default function Badge({
  tone,
  children,
}: {
  tone: 'confirmed' | 'pending' | 'neutral';
  children: string;
}) {
  const cls =
    tone === 'confirmed'
      ? 'bg-ok-bg text-ok-ink'
      : tone === 'pending'
        ? 'bg-wait-bg text-wait-ink'
        : 'bg-ground text-ink-secondary';
  return (
    <span
      className={`inline-block h-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${cls}`}
    >
      {children}
    </span>
  );
}
