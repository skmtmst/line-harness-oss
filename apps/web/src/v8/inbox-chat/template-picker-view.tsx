'use client'

/*
 * ★V8「テンプレートを選ぶ」の窓（M0393 段2「4. テンプレートを選ぶ（ダイアログ 640）」）。
 *
 * 前は大きな2列（左に一覧・右にプレビュー）で、絵と違っていた（オーナー指摘）。
 * 絵は幅640の窓：左にテンプレートの画面と同じフォルダの列（よく使う・すべて・フォルダ・未分類）、
 * 右に探す欄とテンプレートのカード。下に「2通以上を続けて送る」のスイッチと キャンセル・入力欄に入れる。
 * スイッチを入れると番号つきで選べ、帯に送る順が出て「n通を続けて送る」になる（2つの形）。
 *
 * データ（読み込み・絞り込み・続き・差し込みの解決）は components/chats/template-picker の今の処理を使い、
 * ここは見た目だけを受け持つ。
 */
import type { RefObject } from 'react'
import { CornerDownLeft, Folder, FolderOpen, Inbox, Send } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import Toggle from '@/components/shared/toggle'
import SearchField from '@/components/shared/search-field'
import styles from './inbox-chat.module.css'

export type TemplatePickerSideKey = 'frequent' | 'all' | 'none' | `folder:${string}`

export type TemplatePickerViewProps = {
  onClose: () => void
  search: string
  onSearch: (next: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  side: {
    active: TemplatePickerSideKey
    allCount: number | null
    noneCount: number | null
    folders: Array<{ id: string; name: string; color: string | null; count: number | null; depth?: number }>
    status: 'loading' | 'ready' | 'error'
  }
  onPickSide: (key: TemplatePickerSideKey) => void
  status: 'idle' | 'loading' | 'ready' | 'error'
  emptyText: string
  frequentNote: boolean
  templates: Array<{ id: string; name: string; content: string }>
  selectedId: string | null
  onSelect: (id: string) => void
  /** 渡されたときだけ「2通以上を続けて送る」が出る */
  canPack: boolean
  packMode: boolean
  onPackMode: (next: boolean) => void
  packItems: Array<{ id: string; name: string }>
  remaining: number
  loadingMore: boolean
  onLoadMore: () => void
  unresolved: string[] | null
  onConfirm: () => void
  confirmDisabled: boolean
}

const PACK_MAX = 5

export default function TemplatePickerView(props: TemplatePickerViewProps) {
  const { side, packMode, packItems } = props
  const sideRow = (key: TemplatePickerSideKey, label: string, icon: React.ReactNode, count: number | null, depth = 0) => (
    <button
      key={key}
      type="button"
      className={styles.tpSideRow}
      data-depth={depth || undefined}
      aria-pressed={side.active === key}
      onClick={() => props.onPickSide(key)}
      title={label}
    >
      {icon}
      <span className={styles.tpSideName}>{label}</span>
      {count === null ? null : <span className={styles.tpSideCount}>{count}</span>}
    </button>
  )

  return (
    <Dialog
      open
      onCancel={props.onClose}
      title="テンプレートを選ぶ"
      designWidth={640}
      designHeaderPadding="var(--tpl-inbox-tp-head-pad)"
      footer={(
        <>
          <div className={styles.tpBody}>
            <nav className={styles.tpSide} aria-label="フォルダ">
              {sideRow('frequent', 'よく使う', <FolderOpen aria-hidden="true" className={styles.tpSideIcon} />, null)}
              {sideRow('all', 'すべて', <Inbox aria-hidden="true" className={styles.tpSideIcon} />, side.allCount)}
              <p className={styles.tpSideLabel}>フォルダ</p>
              {side.status === 'error' ? (
                <p className={styles.tpSideNote}>フォルダを読み込めませんでした</p>
              ) : side.folders.map((folder) => sideRow(
                `folder:${folder.id}`,
                folder.name,
                <Folder aria-hidden="true" className={styles.tpSideIcon} style={{ color: folder.color ?? undefined, fill: folder.color ?? 'none' }} />,
                folder.count,
                folder.depth,
              ))}
              {sideRow('none', '未分類', <Folder aria-hidden="true" className={styles.tpSideIcon} />, side.noneCount)}
            </nav>
            <div className={styles.tpList}>
              <SearchField
                ref={props.searchInputRef}
                value={props.search}
                onChange={props.onSearch}
                onClear={() => props.onSearch('')}
                placeholder="テンプレート名・本文で探す"
                aria-label="テンプレート名・本文で探す"
                className={styles.tpSearchField}
              />
              {props.frequentNote ? (
                <p className={styles.tpNote}>まだ送信・使用の実績がないため、実績順ではなく登録順で表示しています。</p>
              ) : null}
              {props.status === 'loading' || props.status === 'idle' ? (
                <p className={styles.tpNote}>テンプレートを読み込んでいます。</p>
              ) : props.status === 'error' ? (
                <p className={styles.tpError}>テンプレートを読み込めませんでした。もう一度開き直してください。</p>
              ) : props.templates.length === 0 ? (
                <p className={styles.tpNote}>{props.emptyText}</p>
              ) : (
                <ul className={styles.tpCards}>
                  {props.templates.map((template) => {
                    const packIndex = packItems.findIndex((item) => item.id === template.id)
                    const chosen = packMode ? packIndex >= 0 : props.selectedId === template.id
                    return (
                      <li key={template.id}>
                        <button
                          type="button"
                          className={styles.tpCard}
                          aria-pressed={chosen}
                          onClick={() => props.onSelect(template.id)}
                        >
                          {packMode ? (
                            packIndex >= 0
                              ? <span className={styles.tpNum} aria-label={`${packIndex + 1}番目`}>{packIndex + 1}</span>
                              : <span className={styles.tpBox} aria-hidden="true" />
                          ) : null}
                          <span className={styles.tpCardText}>
                            <span className={styles.tpCardName} title={template.name}>{template.name}</span>
                            <span className={styles.tpCardBody}>{template.content}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {props.remaining > 0 ? (
                <Button variant="secondary" size="compact" onClick={props.onLoadMore} disabled={props.loadingMore}>
                  {props.loadingMore ? '読み込み中...' : `さらに表示（残り${props.remaining}件）`}
                </Button>
              ) : null}
            </div>
          </div>
          {props.unresolved && props.unresolved.length > 0 ? (
            <p className={styles.tpError} role="alert">
              解決できない差し込みがあります: {props.unresolved.map((v) => `{{${v}}}`).join(' ')}。このまま送信するとエラーになります。
            </p>
          ) : null}
          {packMode && packItems.length > 0 ? (
            <div className={styles.tpBand}>
              <span className={styles.tpBandLabel}>続けて送る順：</span>
              <span className={styles.tpBandOrder} title={packItems.map((item) => item.name).join(' → ')}>
                {packItems.map((item, index) => `${'①②③④⑤'[index] ?? `${index + 1}.`} ${item.name}`).join(' → ')}
              </span>
              <span className={styles.tpBandCount}>{packItems.length} / {PACK_MAX}通</span>
            </div>
          ) : null}
          <div className={styles.tpFoot}>
            <div className={styles.tpFootLead}>
              {props.canPack ? (
                <>
                  <Toggle checked={packMode} label="2通以上を続けて送る" onChange={props.onPackMode} />
                  <span className={styles.tpFootText}>
                    <span className={styles.tpFootTitle}>2通以上を続けて送る</span>
                    <span className={styles.tpFootSub}>最大5通・選んだ順に送る</span>
                  </span>
                </>
              ) : null}
            </div>
            <div className={styles.tpFootActions}>
              <Button onClick={props.onClose}>キャンセル</Button>
              <Button variant="primary" onClick={props.onConfirm} disabled={props.confirmDisabled}>
                {packMode
                  ? <><Send aria-hidden="true" size={15} />{packItems.length}通を続けて送る</>
                  : <><CornerDownLeft aria-hidden="true" size={15} />入力欄に入れる</>}
              </Button>
            </div>
          </div>
        </>
      )}
    />
  )
}
