import Icon from './Icon.js';

/**
 * ★V7 の手順の番号 (予約は4つ: メニュー・担当・日時・確認)。
 * 済みはチェック、今は番号＋濃い緑、これからは灰色の番号。
 */
export default function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1" aria-label="予約の手順">
      {steps.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1 last:flex-none">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                done || now ? 'bg-accent-deep text-white' : 'bg-ground text-ink-faint'
              }`}
              aria-hidden="true"
            >
              {done ? <Icon name="check" className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={`truncate text-xs whitespace-nowrap ${
                now ? 'font-bold text-ink' : 'text-ink-faint'
              }`}
              aria-current={now ? 'step' : undefined}
            >
              {label}
            </span>
            {i < steps.length - 1 && <span className="mx-1 h-px flex-1 bg-hairline" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
