import { useEffect, useState } from 'react';
import { api, type MenuItem } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from './LoadErrorView.js';
import LoadingView from './LoadingView.js';
import Icon from './ui/Icon.js';

/**
 * 1-a メニューを選ぶ。札を押すと選ばれるだけで、進むのは下の操作の帯。
 * (撮影: ボタン名にメニュー名をそのまま出す。qa-shots.mjs が名前で押す)
 */
export default function MenuList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (m: MenuItem) => void;
}) {
  const [menus, setMenus] = useState<MenuItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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

  if (failed) return <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!menus) return <LoadingView />;

  const grouped = new Map<string, MenuItem[]>();
  for (const m of menus) {
    const key = m.category_label ?? 'その他';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-base font-bold text-ink">メニューを選んでください</h2>
      {[...grouped.entries()].map(([cat, items]) => (
        <section key={cat}>
          <h3 className="mb-2 text-sm font-semibold text-ink-secondary">{cat}</h3>
          <ul className="space-y-2">
            {items.map((m) => {
              const selected = m.id === selectedId;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(m)}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-3 rounded-xl border bg-canvas p-4 text-left focus-visible:outline-2 focus-visible:outline-ink ${
                      selected ? 'border-accent-deep' : 'border-hairline'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-ink" title={m.name}>
                        {m.name}
                      </div>
                      {m.description && (
                        <div className="mt-0.5 truncate text-sm text-ink-secondary" title={m.description}>
                          {m.description}
                        </div>
                      )}
                      <div className="mt-0.5 text-sm text-ink-secondary">
                        {m.duration_minutes}分・¥{m.base_price.toLocaleString()}（目安）
                      </div>
                    </div>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                        selected ? 'bg-accent-deep text-white' : 'border border-hairline text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <Icon name="check" className="h-4 w-4" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
