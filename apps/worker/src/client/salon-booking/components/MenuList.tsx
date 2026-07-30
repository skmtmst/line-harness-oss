import { useEffect, useState } from 'react';
import {
  createApi,
  type BookingOptionItem,
  type MenuItem,
} from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';

export default function MenuList({
  locationId,
  initialExpandedMenuId,
  onConfirm,
}: {
  locationId: string;
  initialExpandedMenuId?: string | null;
  onConfirm: (menu: MenuItem, options: BookingOptionItem[]) => void;
}) {
  const ctx = useSalonContext();
  const [menus, setMenus] = useState<MenuItem[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedMenuId ?? null);
  const [optionsByMenu, setOptionsByMenu] = useState<Record<string, BookingOptionItem[]>>({});
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionError, setOptionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    createApi(ctx)
      .menus()
      .then((result) => {
        setMenus(result.menus);
        if (
          initialExpandedMenuId &&
          result.menus.some((menu) => menu.id === initialExpandedMenuId)
        ) {
          setExpandedId(initialExpandedMenuId);
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [ctx, initialExpandedMenuId]);

  useEffect(() => {
    if (!expandedId || optionsByMenu[expandedId]) return;
    let cancelled = false;
    setLoadingOptions(true);
    setOptionError(null);
    createApi(ctx)
      .options(expandedId, locationId)
      .then((result) => {
        if (!cancelled) {
          setOptionsByMenu((current) => ({ ...current, [expandedId]: result.options }));
        }
      })
      .catch((reason) => {
        if (!cancelled) setOptionError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, expandedId, locationId, optionsByMenu]);

  if (error) {
    return (
      <div className="sb-card text-center" style={{ animation: 'sb-fade-in 0.3s' }}>
        <p className="mb-3 text-sm text-red-600">メニュー情報の取得に失敗しました</p>
        <p className="mb-4 text-xs text-gray-500">{error}</p>
        <button onClick={() => window.location.reload()} className="text-sm font-semibold sb-line-green-text underline">
          再読み込み
        </button>
      </div>
    );
  }
  if (!menus) {
    return <div className="flex flex-col items-center py-12"><div className="sb-spinner" /><p className="mt-3 text-sm text-gray-500">メニューを読み込み中…</p></div>;
  }
  if (menus.length === 0) {
    return <div className="sb-card text-center text-sm text-gray-500">まだメニューが登録されていません</div>;
  }

  const grouped = new Map<string, MenuItem[]>();
  for (const menu of menus) {
    const key = menu.category_label ?? 'メニュー';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(menu);
  }

  function toggleMenu(menuId: string) {
    setExpandedId((current) => (current === menuId ? null : menuId));
    setSelectedOptionIds([]);
    setOptionError(null);
  }

  return (
    <div className="space-y-5 sb-fade-in">
      <div>
        <h1 className="text-base font-bold text-gray-900">メニューを選んでください</h1>
        <p className="mt-1 text-xs text-gray-500">タップすると、詳しい施術内容と追加オプションを確認できます</p>
      </div>
      {[...grouped.entries()].map(([category, items]) => (
        <section key={category} className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{category}</h2>
          <ul className="space-y-3">
            {items.map((menu) => {
              const expanded = expandedId === menu.id;
              const options = optionsByMenu[menu.id] ?? [];
              const selectedOptions = options.filter((option) => selectedOptionIds.includes(option.id));
              const totalPrice = menu.base_price + selectedOptions.reduce((sum, option) => sum + option.additional_price, 0);
              const totalDuration = menu.duration_minutes + selectedOptions.reduce((sum, option) => sum + option.additional_duration_minutes, 0);
              return (
                <li key={menu.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleMenu(menu.id)}
                    aria-expanded={expanded}
                    className="w-full p-4 text-left active:bg-gray-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold leading-6 text-gray-900">{menu.name}</div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          <span className="font-bold sb-line-green-text">¥{menu.base_price.toLocaleString()}</span>
                          <span className="text-gray-500">所要 {menu.duration_minutes}分</span>
                        </div>
                      </div>
                      <span className="mt-1 text-lg font-bold text-green-600" aria-hidden>{expanded ? '−' : '＋'}</span>
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t border-gray-100 px-4 pb-5 pt-4 sb-slide-up">
                      {menu.description ? (
                        <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{menu.description}</div>
                      ) : (
                        <p className="text-sm text-gray-500">詳しい内容はスタッフまでお問い合わせください。</p>
                      )}

                      <section className="mt-6 border-t border-gray-100 pt-5">
                        <h3 className="text-sm font-bold text-slate-800">追加オプション</h3>
                        <p className="mt-1 text-xs text-gray-500">ご希望のオプションがあれば選択してください（任意）</p>
                        {loadingOptions && <p className="mt-3 text-xs text-gray-500">オプションを読み込み中…</p>}
                        {optionError && <p className="mt-3 text-xs text-red-600">オプションの取得に失敗しました。もう一度メニューを開いてください。</p>}
                        {!loadingOptions && !optionError && options.length === 0 && (
                          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-3 text-xs text-gray-500">このメニューで選択できる追加オプションはありません。</p>
                        )}
                        <div className="mt-3 space-y-2">
                          {options.map((option) => {
                            const checked = selectedOptionIds.includes(option.id);
                            return (
                              <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => setSelectedOptionIds((current) => (
                                    current.includes(option.id)
                                      ? current.filter((id) => id !== option.id)
                                      : [...current, option.id]
                                  ))}
                                  className="mt-1 h-5 w-5 shrink-0 accent-green-600"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-bold text-slate-800">{option.name}</span>
                                  {option.description && <span className="mt-1 block whitespace-pre-wrap text-xs leading-5 text-gray-600">{option.description}</span>}
                                  <span className="mt-1 block text-xs font-semibold text-green-700">
                                    +¥{option.additional_price.toLocaleString()}
                                    {option.additional_duration_minutes > 0 && ` / +${option.additional_duration_minutes}分`}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </section>

                      <div className="mt-5 rounded-xl bg-green-50 px-4 py-3 text-sm">
                        <div className="flex justify-between"><span className="text-gray-600">合計料金</span><strong className="text-green-700">¥{totalPrice.toLocaleString()}</strong></div>
                        <div className="mt-1 flex justify-between"><span className="text-gray-600">合計所要時間</span><strong className="text-slate-800">{totalDuration}分</strong></div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onConfirm(menu, selectedOptions)}
                        className="mt-4 w-full rounded-xl py-3.5 text-sm font-bold text-white shadow-sm active:scale-[0.99]"
                        style={{ background: '#06C755' }}
                      >
                        このメニューで予約する
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
