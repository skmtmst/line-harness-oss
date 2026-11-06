/**
 * LINE ログインの吹き出しの印。LINE が配る形に近い単純な形を SVG で持つ
 * （新しい依存は足さない）。色は置いた場所の文字色に従う。
 */
export default function LineLoginMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 3C6.477 3 2 6.134 2 10c0 2.22 1.33 4.2 3.4 5.5-.13 1.13-.55 2.4-1.24 3.35-.19.26.08.6.38.49 1.74-.63 3.1-1.48 4-2.16.87.2 1.8.32 2.76.32 5.52 0 10-3.13 10-7s-4.48-7-10-7Z" />
    </svg>
  )
}
