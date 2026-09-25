import type { ReactNode } from 'react';

/**
 * ★V7 の下の操作の帯。進む操作はここにだけ置き、画面の下に固定する。
 * 使う画面は本文の末尾に同じ高さの余白 (pb-28) を足すこと。
 */
export default function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 border-t border-hairline bg-canvas px-4 pt-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}
