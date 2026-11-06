/**
 * ★V8 の手順の印 (予約は4つ: メニュー・担当・日時・確認)。
 * 済みと今は濃い緑の短い棒、これからは灰色。棒の下に「N 名前」。
 * 段が増えても (支払い段など) steps を足すだけで同じ形になる。
 */
export default function Stepper({ steps, current, appearance }: { steps: string[]; current: number; appearance?: 'restaurant' }) {
  if (appearance === 'restaurant') return <ol className="flex gap-2" aria-label="予約の手順">{steps.map((label,i)=><li key={label} aria-current={i===current?'step':undefined} className={`rounded-full px-2 py-0.5 text-[11px] leading-[17px] font-semibold ${i===current?'bg-liff-primary text-(--liff-on-primary)':'bg-liff-chip text-liff-sub'}`}>{`${i+1} ${label}`}</li>)}</ol>;
  return (
    <ol className="flex gap-1 px-4 pt-3 pb-1" aria-label="予約の手順">
      {steps.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} className="min-w-0 flex-1">
            <span
              className={`block h-[3px] rounded-full ${done || now ? 'bg-liff-primary' : 'bg-liff-line'}`}
              aria-hidden="true"
            />
            <span
              className={`mt-1 block truncate text-[10px] whitespace-nowrap ${
                now ? 'font-bold text-ink' : done ? 'font-medium text-liff-sub' : 'font-medium text-liff-idle'
              }`}
              aria-current={now ? 'step' : undefined}
            >
              {i + 1} {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
