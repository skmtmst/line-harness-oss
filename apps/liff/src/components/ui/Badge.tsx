/**
 * ★V8 の札。状態は色だけにせず文字を出す。
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
      ? 'bg-[var(--liff-look-ok-bg)] text-[var(--liff-look-ok-ink)]'
      : tone === 'pending'
        ? 'bg-[var(--liff-look-wait-bg)] text-[var(--liff-look-wait-ink)]'
        : 'bg-[var(--liff-look-chip)] text-[var(--liff-look-sub)]';
  return (
    <span
      className={`inline-block h-fit w-fit shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap ${cls}`}
    >
      {children}
    </span>
  );
}
