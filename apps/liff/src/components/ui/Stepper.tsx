/**
 * ★V8 の手順の印 (予約は4つ: メニュー・担当・日時・確認)。
 * 済みと今は濃い緑の短い棒、これからは灰色。棒の下に「N 名前」。
 * 段が増えても (支払い段など) steps を足すだけで同じ形になる。
 */
export default function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex gap-1 px-4 pt-2 pb-1" aria-label="予約の手順">
      {steps.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} className="min-w-0 flex-1">
            <span
              className={`block h-[3px] rounded-full ${done || now ? 'bg-[var(--liff-look-main)]' : 'bg-[var(--liff-look-line)]'}`}
              aria-hidden="true"
            />
            <span
              className={`mt-1 block truncate text-[10px] whitespace-nowrap ${
                now
                  ? 'font-bold text-[var(--liff-look-ink)]'
                  : done
                    ? 'font-medium text-[var(--liff-look-sub)]'
                    : 'font-medium text-[var(--liff-look-idle)]'
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
