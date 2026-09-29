import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/*
 * お客様の画面（LIFF）の「？」。管理画面の shared/help-tip と同じ約束。
 * （lucide が無いので、circle-help の絵は SVG で内蔵する）
 *
 * 定義・分母・計算のしかた・単位・いつ時点の数か・言葉の意味だけを入れる。
 * 押す・タップ・Tab＋Enter で開く。ホバーだけでは開かない。
 * Esc や外を押すと閉じ、1つ開くと他は閉じる。
 */

const CLOSE_OTHERS_EVENT = 'liff-help-tip-open';

export default function HelpTip({
  label,
  align = 'left',
  children,
}: {
  /** 読み上げ名（例：「確定待ちの説明」）。吹き出しとは aria-describedby でつなぐ。 */
  label: string;
  /** 吹き出しの寄せ。右端の札では right にする（画面からはみ出さない）。 */
  align?: 'left' | 'right';
  /** 1〜2文の補足。 */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 1つ開くと他は閉じる。開いた側が合図し、違う持ち主だけ閉じる。
  useEffect(() => {
    if (!open) return;
    const closeOthers = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== tipId) setOpen(false);
    };
    window.addEventListener(CLOSE_OTHERS_EVENT, closeOthers);
    return () => window.removeEventListener(CLOSE_OTHERS_EVENT, closeOthers);
  }, [open, tipId]);

  // Esc や外を押すと閉じる。Escでは押した？へ戻る。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const toggle = () => {
    setOpen((current) => {
      if (!current) window.dispatchEvent(new CustomEvent(CLOSE_OTHERS_EVENT, { detail: tipId }));
      return !current;
    });
  };

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center align-middle"
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onClick={toggle}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      </button>
      {open ? (
        <span
          role="note"
          id={tipId}
          className={`absolute top-[calc(100%+4px)] z-10 w-max max-w-[min(19rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs leading-relaxed font-normal text-gray-600 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
