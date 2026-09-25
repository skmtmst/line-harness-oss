import { useEffect, useState } from 'react';
import { api, type StaffItem } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from './LoadErrorView.js';
import LoadingView from './LoadingView.js';
import Icon from './ui/Icon.js';

/**
 * 1-b 担当を選ぶ。札を押すと選ばれるだけで、進むのは下の操作の帯。
 * 担当できる人がいないときは、その理由だけ出す (案内は付けない)。
 */
export default function StaffList({
  menuId,
  basePrice,
  selectedId,
  onSelect,
}: {
  menuId: string;
  basePrice: number;
  selectedId: string | null;
  onSelect: (s: StaffItem) => void;
}) {
  const [list, setList] = useState<StaffItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setFailed(false);
    api
      .staffOf(menuId)
      .then((r) => setList(r.staff))
      .catch((e) => {
        logFailure('staff', e);
        setFailed(true);
      });
  }, [menuId, reloadKey]);

  if (failed) return <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!list) return <LoadingView />;
  if (list.length === 0) {
    return <p className="text-sm leading-6 text-ink-secondary">このメニューを担当できるスタッフがいません。</p>;
  }

  return (
    <div className="space-y-5">
      <h2 className="text-base font-bold text-ink">担当を選んでください</h2>
      <ul className="space-y-2">
        {list.map((s) => {
          const selected = s.id === selectedId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3 rounded-xl border bg-canvas p-4 text-left focus-visible:outline-2 focus-visible:outline-ink ${
                  selected ? 'border-accent-deep' : 'border-hairline'
                }`}
              >
                {s.profile_image_url ? (
                  <img
                    src={s.profile_image_url}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ground text-ink-faint"
                    aria-hidden="true"
                  >
                    <Icon name="user" className="h-6 w-6" />
                  </span>
                )}
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-semibold text-ink" title={s.display_name}>
                    {s.display_name}
                  </span>
                  {s.role && (
                    <span className="block truncate text-sm text-ink-secondary" title={s.role}>
                      {s.role}
                    </span>
                  )}
                  {s.price !== basePrice && (
                    <span className="block text-xs text-ink-secondary">
                      ¥{s.price.toLocaleString()}〜
                    </span>
                  )}
                </span>
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
    </div>
  );
}
