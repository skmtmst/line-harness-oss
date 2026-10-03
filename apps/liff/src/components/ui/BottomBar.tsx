import type { ReactNode } from 'react';

/**
 * ★V8 の下の操作の帯。進む操作はここにだけ置き、画面の下に固定する。
 * 選んだ中身の一行・主ボタン・「戻る」が縦に並ぶ。使う画面は本文の
 * 末尾に同じ高さの余白 (pb-40) を足すこと。
 * ★A: 下から 12px 浮いた横いっぱいのボタンにし、上にふんわり影を付ける。
 */
export default function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 px-4"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex w-full max-w-md flex-col items-stretch gap-2 rounded-[14px] bg-canvas p-3 shadow-lg">
        {children}
      </div>
    </div>
  );
}
