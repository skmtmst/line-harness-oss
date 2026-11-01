'use client'

/*
 * テンプレートの本文を2行まで読み、中身を見る時だけ窓の右に見本を開く。
 * 左はフォルダ、一覧の下には続けて送る操作と入力欄へ入れる操作を置く。
 * スイッチを入れると番号つきで選べ、帯に送る順が出て「n通を続けて送る」になる（2つの形）。
 *
 * データ（読み込み・絞り込み・続き・差し込みの解決）は components/chats/template-picker の今の処理を使い、
 * ここは見た目だけを受け持つ。
 */
import { useInsertTokenNames } from '@/lib/use-insert-token-names'
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { CornerDownLeft, FolderOpen, Search, Send } from 'lucide-react'
import { EntityPickerDialog } from '@/components/shared/entity-picker'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import { Tabs } from '@/components/shared/tabs'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import Toggle from '@/components/shared/toggle'
import SearchField from '@/components/shared/search-field'
import styles from '@/components/shared/entity-picker.module.css'
import { InsertText } from '@/components/shared/insert-text-field'
import { formatNumber } from '@/lib/format'

export type TemplatePickerSideKey = 'frequent' | 'all' | 'none' | `folder:${string}`

export type TemplatePickerViewProps = {
  accountId?: string | null
  onClose: () => void
  channel: 'line' | 'email'
  canPick: boolean
  lockedReason?: string
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
  previewId: string | null
  onPreview: (id: string) => void
  onClosePreview: () => void
  onSelect: (id: string) => void
  /** 渡されたときだけ「2通以上を続けて送る」が出る */
  canPack: boolean
  packMode: boolean
  onPackMode: (next: boolean) => void
  packItems: Array<{ id: string; name: string }>
  remaining: number
  loadingMore: boolean
  onLoadMore: () => void
  resolvedPreview: { id: string; content: string } | null
  unresolved: string[] | null
  onConfirm: () => void
  confirmDisabled: boolean
}

const PACK_MAX = 5

export default function TemplatePickerView(props: TemplatePickerViewProps) {
  const { side, packMode, packItems } = props
  const tokenNames = useInsertTokenNames(props.channel === 'line' ? props.accountId ?? null : null)
  const previewTriggers = useRef(new Map<string, HTMLButtonElement>())
  const returnFocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (props.previewId === null && returnFocus.current) {
      previewTriggers.current.get(returnFocus.current)?.focus()
      returnFocus.current = null
    }
  }, [props.previewId])
  const preview = props.status === 'ready' ? props.templates.find(template => template.id === props.previewId) : null
  const folderRows: FolderPanelRow[] = [
    { id: 'frequent', kind: 'folder', label: 'よく使う', icon: <FolderOpen size={16} aria-hidden="true" />, count: null },
    { id: 'all', kind: 'all', label: 'すべて', count: side.allCount },
    ...(side.status === 'error' ? [] : side.folders.map((folder): FolderPanelRow => ({
      id: `folder:${folder.id}`, kind: 'folder', label: folder.name, color: folder.color, count: folder.count,
    }))),
    { id: 'none', kind: 'unfiled', label: '未分類', count: side.noneCount },
  ]

  return (
    <EntityPickerDialog
      onCancel={props.onClose}
      title="テンプレートを選ぶ"
      wide={props.channel === 'line'}
      navigation={props.channel === 'line' ? <Tabs size="compact" label="テンプレートの種類" items={[
        { label: 'メッセージ', current: true, count: side.allCount ?? undefined },
        ...['カルーセル', 'リッチメッセージ', 'リッチビデオ', '質問', 'クーポン', 'リサーチ'].map(label => ({ label, disabled: true, disabledReason: '受信箱からはまだ送れません' })),
      ]} /> : undefined}
      preview={props.channel === 'line' && preview ? {
        title: preview.name,
        onClose: () => { returnFocus.current = preview.id; props.onClosePreview() },
        content: <LinePreview fit title={null}><LinePreviewMessage accountName="" avatar={null} time="">{props.resolvedPreview?.id === preview.id ? props.resolvedPreview.content : preview.content}</LinePreviewMessage></LinePreview>,
      } : undefined}
      error={props.unresolved?.length ? `解決できない差し込みがあります: ${props.unresolved.map(v => `{{${v}}}`).join(' ')}。このまま送信するとエラーになります。` : undefined}
      band={packMode && packItems.length > 0 ? (
            <div className={styles.tpBand}>
              <span className={styles.tpBandLabel}>続けて送る順：</span>
              <span className={styles.tpBandOrder} title={packItems.map((item) => item.name).join(' → ')}>
                {packItems.map((item, index) => `${'①②③④⑤'[index] ?? `${index + 1}.`} ${item.name}`).join(' → ')}
              </span>
              <span className={styles.tpBandCount}>{packItems.length} / {PACK_MAX}通</span>
            </div>
      ) : undefined}
      footer={<>
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
              <Button variant="primary" onClick={props.onConfirm} lockedReason={props.lockedReason} disabled={!props.canPick || props.confirmDisabled}>
                {packMode
                  ? <><Send aria-hidden="true" size={16} />{formatNumber(packItems.length)}通を続けて送る</>
                  : <><CornerDownLeft aria-hidden="true" size={16} />入力欄に入れる</>}
              </Button>
            </div>
      </>}
    >
          <div className={styles.tpBody}>
            <div className={styles.tpSide}>
              <FolderPanel readOnly rows={folderRows} activeId={side.active} onSelect={(key) => props.onPickSide(key as TemplatePickerSideKey)} />
              {side.status === 'error' ? <p className={styles.tpSideNote}>フォルダを読み込めませんでした</p> : null}
            </div>
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
                      <li key={template.id} className={styles.tpCardRow}>
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
                            <span className={styles.tpCardBody} data-lines={props.channel === 'line' ? '2' : undefined} title={template.content}>{props.channel === 'line' ? <InsertText tokenNames={tokenNames} value={template.content} resolvedValue={props.resolvedPreview?.id === template.id ? props.resolvedPreview.content : undefined} /> : template.content}</span>
                          </span>
                        </button>
                        {props.channel === 'line' ? <IconButton ref={node => { if (node) previewTriggers.current.set(template.id, node); else previewTriggers.current.delete(template.id) }} aria-label={`${template.name}の中身を見る`} title="中身を見る" onClick={() => props.onPreview(template.id)}><Search size={16} aria-hidden="true" /></IconButton> : null}
                      </li>
                    )
                  })}
                </ul>
              )}
              {props.remaining > 0 ? (
                <Button variant="secondary" size="compact" onClick={props.onLoadMore} disabled={props.loadingMore} busy={props.loadingMore} busyLabel="読み込み中…">
                  {`さらに表示（残り${formatNumber(props.remaining)} 件）`}
                </Button>
              ) : null}
            </div>
          </div>
    </EntityPickerDialog>
  )
}
