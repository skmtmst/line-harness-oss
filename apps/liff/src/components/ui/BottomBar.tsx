import type { ReactNode } from 'react';

/**
 * ★V8 の下の操作の帯。進む操作はここにだけ置き、画面の下に固定する。
 * 選んだ中身の一行・主ボタン・「戻る」が縦に並ぶ。使う画面は本文の
 * 末尾に同じ高さの余白 (pb-40) を足すこと。
 * ★A: 下から 12px 浮いた横いっぱいのボタンにし、上にふんわり影を付ける。
 * 板 (IruGD など) では主ボタンの下端が画面の下から 30px。浮いた 12px は
 * そのままに、帯の中の下の余白を 18px にしてボタンの高さを板に合わせる。
 */
export default function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 px-4"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex w-full max-w-md flex-col items-stretch gap-2 rounded-(--liff-radius-lg) bg-canvas p-3 pb-[18px] shadow-lg">
        {children}
      </div>
    </div>
  );
}
