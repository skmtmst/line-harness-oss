import { useEffect, useState } from 'react';
import liff from '@line/liff';
import { api } from '../../lib/api.js';
import { logFailure } from '../../lib/user-message.js';
import Icon from './Icon.js';

// 店名は画面ごとに読み直さない。最初に取れた値をモジュールに持つ。
let cachedShopName: string | null = null;

/**
 * ★V8 の上の帯。×・題・店名・… の1行 (高さ48)。全画面で同じ形。
 * 店名は /api/liff/config の accountName。読めないときは空のままにする
 * (帯の形は変えず、店名のところだけ空ける)。
 */
export function liffDocumentTitle(title: string): string {
  const name = title.trim();
  return name ? `${name} | musubo` : 'musubo';
}

export default function LiffHeader({ title }: { title: string }) {
  const [shopName, setShopName] = useState(cachedShopName);

  // ブラウザ・LINE の上に出る題も、帯の題と同じ画面名にする（「<画面名> | musubo」）。
  useEffect(() => {
    document.title = liffDocumentTitle(title);
  }, [title]);

  useEffect(() => {
    if (cachedShopName !== null) return;
    api
      .liffConfig()
      .then((r) => {
        cachedShopName = r.data?.accountName ?? '';
        setShopName(cachedShopName);
      })
      .catch((e) => {
        logFailure('liff-config', e);
        cachedShopName = '';
      });
  }, []);

  return (
    <header className="sticky top-0 z-10 border-b border-liff-line bg-canvas">
      <div className="mx-auto flex h-(--liff-header-h) w-full max-w-md items-center gap-2 px-3">
        <button
          type="button"
          aria-label="閉じる"
          onClick={() => liff.closeWindow()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <Icon name="x" className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <p className="max-w-full truncate text-[13px] font-bold text-ink">
            {title}
          </p>
          {shopName && (
            <p
              className="max-w-full truncate text-[10px] text-liff-sub"
              title={shopName}
            >
              {shopName}
            </p>
          )}
        </div>
        <span
          className="flex h-10 w-8 shrink-0 items-center justify-center text-ink"
          aria-hidden="true"
        >
          <Icon name="ellipsis" className="h-5 w-5" />
        </span>
      </div>
    </header>
  );
}
