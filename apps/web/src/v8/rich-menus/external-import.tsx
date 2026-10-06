/*
 * 「LINE上にあるメニュー」の取り込み作業画面と、その型（板 `TL7tp`）。
 * app/rich-menus/external-import.tsx から写した（src/v8 は古い画面を import しない）。
 * 決まった幅・列の値は `--tpl-rml-ext-*`（globals.css）。
 */
import { useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import styles from './external-import.module.css'

export type LineMenu = {
  richMenuId: string
  name: string
  chatBarText: string
  size: { width: number; height: number }
  areasCount: number
  areas?: Array<{
    bounds: { x: number | null; y: number | null; width: number | null; height: number | null }
    action: {
      type: string
      label: string | null
      url: string | null
      text: string | null
      displayText: string | null
      richMenuAliasId: string | null
      supported: boolean
      unsupportedReason: 'unsupported_or_incomplete_action' | null
    }
  }>
  isCurrentDefault: boolean
  adminManaged: boolean
  adminInfo: {
    groupId: string
    groupName: string
    pageName: string
    groupStatus: 'draft' | 'published'
  } | null
}

export function ExternalImportWorkspace({
  external,
  loading,
  error,
  onBack,
  onReload,
  onImport,
}: {
  external: { currentDefault: string | null; lineMenus: LineMenu[] } | null
  loading: boolean
  error: string | null
  onBack: () => void
  onReload: () => void
  onImport: (menu: LineMenu) => void
}) {
  const unmanaged = external?.lineMenus.filter((menu) => !menu.adminManaged) ?? []
  const [selectedId, setSelectedId] = useState(unmanaged[0]?.richMenuId ?? '')
  const selected = unmanaged.find((menu) => menu.richMenuId === selectedId) ?? unmanaged[0] ?? null
  const areas = selected ? Array.from({ length: Math.min(selected.areasCount, 6) }, (_, index) => String.fromCharCode(65 + index)) : []

  return (
    <div data-design-node="TL7tp" className={`mx-auto flex flex-col gap-4 ${styles.wrap}`}>
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs">
          <button type="button" className="text-action hover:underline" onClick={onBack}>リッチメニュー</button>
          <span className="mx-2">›</span>
          <span>管理画面の外のメニュー</span>
        </nav>
        <Button type="button" onClick={onReload}>↻ LINEから読み直す</Button>
      </div>

      {loading ? <ListState kind="loading" title="LINEのメニューを読み込んでいます" /> : null}
      {!loading && error && !external ? <ListState kind="error" title="LINEのメニューを表示できませんでした" onRetry={onReload} /> : null}
      {!loading && !error && unmanaged.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState kind="empty" title="管理画面の外のメニューはありません" description="LINE側だけにあるメニューが見つかると、ここに表示します。" />
        </div>
      ) : null}

      {!loading && unmanaged.length > 0 ? (
        <div className={`grid items-start gap-4 ${styles.columns}`}>
          <div className="space-y-4">
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-ink text-sm font-bold">LINE側にあって、この管理画面に無いメニュー</h2>
                <span className="text-ink-faint text-xs">{unmanaged.length}件</span>
              </div>
              <div className="space-y-2">
                {unmanaged.map((menu) => {
                  const active = selected?.richMenuId === menu.richMenuId
                  return (
                    <button
                      key={menu.richMenuId}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(menu.richMenuId)}
                      className={`grid w-full items-center gap-3 text-left ${styles.menuRow} ${active ? 'bg-accent-soft' : 'bg-canvas hover:bg-canvas-sunken'}`}
                    >
                      <span className="bg-canvas-sunken text-ink-faint flex h-10 items-center justify-center rounded-control">▧</span>
                      <span className="min-w-0"><strong className="text-ink block truncate text-sm">{menu.name || '名前なし'}</strong><span className="text-ink-faint block truncate text-xs">{menu.areasCount}面・切替なし・画像あり</span></span>
                      <span className="text-ink hidden text-sm font-semibold sm:block">—<small className="text-ink-faint block text-micro font-normal">今月</small></span>
                      <span className="text-ink-secondary hidden text-xs sm:block">作成日不明</span>
                      <span className={styles.importTag}>取り込む</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
              <h2 className="text-ink mb-3 text-sm font-bold">取り込むと、できるようになること</h2>
              <ul className="space-y-3 text-xs text-ink-secondary">
                <li>✓ 面ごとのボタンを、この画面から書き換えられます</li>
                <li>✓ 「誰に出すか」の条件を付けられます（いまは全員に出ています）</li>
                <li>✓ 面ごとのタップ数が取れるようになります</li>
              </ul>
              <Notice tone="info" className="mt-4">ⓘ 取り込んでも、お客さまに出ているメニューは変わりません。中身をこちらで持つようになるだけです。</Notice>
            </section>
          </div>

          {selected ? (
            <aside className="space-y-4">
              <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
                <h2 className="text-ink text-sm font-bold">選んだメニューの中身</h2>
                <p className="text-ink mt-3 text-sm font-semibold">{selected.name || '名前なし'}</p>
                <div className={`border-hairline bg-canvas-sunken mt-3 grid grid-cols-3 overflow-hidden rounded-control border ${selected.size.height * 2 > selected.size.width ? styles.previewLarge : styles.previewCompact}`}>
                  {areas.map((area) => <span key={area} className="border-hairline text-ink-faint flex items-center justify-center border text-xs font-medium">{area}</span>)}
                </div>
                <h3 className="text-ink-secondary mt-3 text-xs font-bold">面ごとの動き（LINEから読んだもの）</h3>
                {selected.areas?.length ? (
                  <ul className="mt-2 space-y-2 text-xs">
                    {selected.areas.slice(0, 6).map((area, index) => (
                      <li key={`${selected.richMenuId}-${index}`} className={`border-hairline grid gap-2 rounded-control border p-2 ${styles.areaRow}`}>
                        <strong className="text-ink">{String.fromCharCode(65 + index)}</strong>
                        <span className={area.action.supported ? 'text-ink-secondary break-words' : 'text-danger break-words'}>
                          {externalActionText(area.action)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-faint mt-2 text-xs leading-5">LINEから面ごとの動きを読み込めませんでした。読み直してから取り込んでください。</p>
                )}
                <Button type="button" variant="primary" className="mt-4" onClick={() => onImport(selected)}>この内容で取り込む</Button>
              </section>
              <Notice tone="warn">
                <h2 className="mb-1 text-xs font-bold">気をつけること</h2>
                <p className="text-xs">・LINE側で作られたメニューは、名前が無いことがあります</p>
                <p className="text-xs">・取り込まずに「LINEから削除」すると、お客さまのメニューがすぐ消えます</p>
              </Notice>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function externalActionText(action: NonNullable<LineMenu['areas']>[number]['action']): string {
  if (!action.supported) return `未対応の動き（${action.type || '種類不明'}）`
  if (action.type === 'uri' && action.url) return `URLを開く（${action.url}）`
  if (action.type === 'message' && action.text) return `メッセージを送る「${action.text}」`
  if (action.type === 'postback') {
    return action.displayText ? `操作を実行して「${action.displayText}」と表示` : '操作を実行'
  }
  if (action.type === 'richmenuswitch' && action.richMenuAliasId) {
    return `別のメニューへ切り替える（${action.richMenuAliasId}）`
  }
  return `未対応の動き（${action.type || '種類不明'}）`
}
