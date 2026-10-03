import { useEffect, useMemo, useState } from 'react';
import { api, type MenuItem } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from './LoadErrorView.js';
import LoadingView from './LoadingView.js';
import Icon from './ui/Icon.js';

const ALL_CATEGORY = 'すべて';

/**
 * 1-a メニューを選ぶ (★V8・IruGD)。札を押すと選ばれるだけで、進むのは下の操作の帯。
 * 種類の札 (すべて・トリミング…) で絞る。選んだ札は緑枠＋薄い緑の地＋緑のチェック。
 * (撮影: ボタン名にメニュー名をそのまま出す。qa-shots.mjs が名前で押す)
 */
export default function MenuList({
  selectedId,
  onSelect,
  onLoadState,
}: {
  selectedId: string | null;
  onSelect: (m: MenuItem) => void;
  /** 読み込み中・失敗・選ぶものが無い間は、下の帯を出さないための合図。 */
  onLoadState?: (ready: boolean) => void;
}) {
  const [menus, setMenus] = useState<MenuItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [category, setCategory] = useState<string>(ALL_CATEGORY);

  useEffect(() => {
    setFailed(false);
    api
      .menus()
      .then((r) => setMenus(r.menus))
      .catch((e) => {
        logFailure('menus', e);
        setFailed(true);
      });
  }, [reloadKey]);

  useEffect(() => {
    onLoadState?.(menus !== null && !failed && menus.length > 0);
  }, [menus, failed, onLoadState]);

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const m of menus ?? []) {
      const c = m.category_label ?? 'その他';
      if (!seen.includes(c)) seen.push(c);
    }
    return seen;
  }, [menus]);

  if (failed) return <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!menus) return <LoadingView />;

  const visible =
    category === ALL_CATEGORY
      ? menus
      : menus.filter((m) => (m.category_label ?? 'その他') === category);

  return (
    <div className="space-y-3.5">
      <h2 className="text-xl font-bold text-ink">メニューを選んでください</h2>
      {categories.length > 1 && (
        <div
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5"
          role="group"
          aria-label="種類でしぼる"
        >
          {[ALL_CATEGORY, ...categories].map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={active}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ink ${
                  active ? 'bg-ink text-canvas' : 'bg-liff-chip text-liff-sub'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}
      <ul className="space-y-2.5">
        {visible.map((m) => {
          const selected = m.id === selectedId;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m)}
                aria-pressed={selected}
                className={`liff-press flex w-full items-center gap-3 rounded-[14px] p-3.5 text-left outline focus-visible:outline-2 focus-visible:outline-ink ${
                  selected
                    ? 'bg-liff-soft outline-2 -outline-offset-1 outline-liff-primary'
                    : 'bg-canvas outline-1 -outline-offset-1 outline-liff-line'
                }`}
              >
                <span
                  className="h-14 w-14 shrink-0 rounded-[10px] bg-liff-photo"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-ink" title={m.name}>
                    {m.name}
                  </span>
                  {m.description && (
                    <span className="mt-[3px] block truncate text-[11.5px] text-liff-sub" title={m.description}>
                      {m.description}
                    </span>
                  )}
                  <span className="mt-[3px] block text-xs">
                    <span className="font-semibold text-ink">{m.duration_minutes}分</span>
                    <span className="ml-2 font-bold text-liff-primary">
                      {m.base_price === 0 ? '無料' : `¥${m.base_price.toLocaleString()}`}
                    </span>
                  </span>
                </span>
                {selected ? (
                  <Icon name="circle-check" className="h-[22px] w-[22px] shrink-0 text-liff-primary" />
                ) : (
                  <Icon name="chevron-right" className="h-[18px] w-[18px] shrink-0 text-liff-idle" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
