import { useEffect, useState } from 'react';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from './LoadErrorView.js';
import LoadingView from './LoadingView.js';
import Icon from './ui/Icon.js';

/**
 * 1-b 担当を選ぶ (★V8・biNP5)。札を押すと選ばれるだけで、進むのは下の操作の帯。
 * 「指名なし」(is_designation_optional) は先頭に来る。脇の文は
 * 「いちばん早く空いている人」か「役職・指名料」。選んだ札は緑枠＋薄い緑。
 * 担当できる人がいないときは、その理由だけ出す (案内は付けない)。
 */
export default function StaffList({
  menu,
  selectedId,
  onSelect,
  onLoadState,
}: {
  /** 選んだメニュー。要約の行 (名前・分・料金) と担当の読み出しに使う。 */
  menu: MenuItem;
  selectedId: string | null;
  onSelect: (s: StaffItem) => void;
  /** 読み込み中・失敗・選ぶものが無い間は、下の帯を出さないための合図。 */
  onLoadState?: (ready: boolean) => void;
}) {
  const [list, setList] = useState<StaffItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setFailed(false);
    api
      .staffOf(menu.id)
      .then((r) => setList(r.staff))
      .catch((e) => {
        logFailure('staff', e);
        setFailed(true);
      });
  }, [menu.id, reloadKey]);

  useEffect(() => {
    onLoadState?.(list !== null && !failed && list.length > 0);
  }, [list, failed, onLoadState]);

  if (failed) return <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!list) return <LoadingView />;
  if (list.length === 0) {
    return <p className="text-[13px] leading-6 text-liff-sub">このメニューを担当できるスタッフがいません。</p>;
  }

  return (
    <div className="space-y-3.5">
      <div>
        <h2 className="text-xl font-bold text-ink">担当を選んでください</h2>
        <p className="mt-1 text-xs text-liff-sub">
          {menu.name}・{menu.duration_minutes}分・
          {menu.base_price === 0 ? '無料' : `¥${menu.base_price.toLocaleString()}`}
        </p>
      </div>
      <ul className="space-y-2.5">
        {list.map((s) => {
          const selected = s.id === selectedId;
          const optional = s.is_designation_optional === 1;
          const diff = s.price - menu.base_price;
          const sub = optional
            ? 'いちばん早く空いている人'
            : [s.role, diff > 0 ? `+¥${diff.toLocaleString()}` : '指名料なし']
                .filter(Boolean)
                .join('・');
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3 rounded-[14px] p-3.5 text-left outline focus-visible:outline-2 focus-visible:outline-ink ${
                  selected
                    ? 'bg-liff-soft outline-2 -outline-offset-1 outline-liff-primary'
                    : 'bg-canvas outline-1 -outline-offset-1 outline-liff-line'
                }`}
              >
                {s.profile_image_url ? (
                  <img
                    src={s.profile_image_url}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                  />
                ) : optional ? (
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-liff-chip text-liff-sub"
                    aria-hidden="true"
                  >
                    <Icon name="users" className="h-[22px] w-[22px]" />
                  </span>
                ) : (
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-liff-photo text-lg font-bold text-liff-photo-ink"
                    aria-hidden="true"
                  >
                    {s.display_name.slice(0, 1)}
                  </span>
                )}
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[15px] font-bold text-ink" title={s.display_name}>
                    {s.display_name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-liff-sub" title={sub}>
                    {sub}
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
