import Icon from './Icon.js';

/**
 * ★V7 の見出し行。題＋(あれば)戻る。押せる所は高さ44以上。
 * 1-a (ご予約) のように戻り先が無いときは onBack を渡さない。
 */
export default function PageHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="flex min-h-11 items-center gap-1">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <Icon name="chevron-left" className="h-6 w-6" />
        </button>
      )}
      <h1 className="text-base font-bold text-ink">{title}</h1>
    </div>
  );
}
