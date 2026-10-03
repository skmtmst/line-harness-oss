import type { ReactNode } from 'react';

/**
 * ★V8 の下の操作の帯。進む操作はここにだけ置き、画面の下に固定する。
 * 選んだ中身の一行・主ボタン・「戻る」が縦に並ぶ。使う画面は本文の
 * 末尾に同じ高さの余白 (pb-40) を足すこと。
 */
export default function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 border-t border-[var(--liff-look-line)] bg-canvas px-4 pt-3"
      style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex w-full max-w-md flex-col items-stretch gap-2">{children}</div>
    </div>
  );
}
