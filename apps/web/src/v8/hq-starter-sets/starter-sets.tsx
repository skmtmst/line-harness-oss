'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, Pencil, Plus, Send } from 'lucide-react'
import Button from '@/components/shared/button'
import FolderPanel from '@/components/shared/folder-panel'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import { RowMenu } from '@/components/shared/row-actions'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { ListPage } from '@/components/templates'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { ACCOUNT_STYLES, hqStyleSetupApi, type AccountStyle, type HqStarterSet, type StarterSetItem } from '@/lib/api-style-setup'
import { styleLabel } from '@/v8/onboarding/model'
import styles from './starter-sets.module.css'

/*
 * 統括の「スタイルの初期セット」（★V8 修正案の列 VHp7p `J6647`。決まり B-311）。
 *
 * スタイルごとに、新しいアカウントで自動で入れる物（リッチメニュー・テンプレート・オートメーション・
 * 予約メニュー・ダッシュボードの型）を束ねて見せる。自動で送る物は「止めた状態で入る」。
 * 読みは組4の `GET /api/hq/style-starter-sets`。作る・直す・配る・標準に戻す・自動で入れるの切り替えは
 * 口が入るまで準備中の窓（B-314）。
 */

const KIND_ROWS: ReadonlyArray<{ kind: StarterSetItem['kind']; label: string; how: { text: string; tone: 'neutral' | 'warning' } }> = [
  { kind: 'rich_menu', label: 'リッチメニュー', how: { text: '見本の札つきで入る', tone: 'neutral' } },
  { kind: 'template', label: 'テンプレート', how: { text: '見本の札つきで入る', tone: 'neutral' } },
  { kind: 'automation', label: 'オートメーション', how: { text: '止めた状態で入る', tone: 'warning' } },
  { kind: 'booking_menu', label: '予約メニュー', how: { text: '見本の札つきで入る', tone: 'neutral' } },
  { kind: 'dashboard', label: 'ダッシュボードの型', how: { text: 'そのまま入る', tone: 'neutral' } },
]

function nameOf(list: StarterSetItem[], kind: StarterSetItem['kind']): { main: string; sub?: string } {
  if (kind === 'rich_menu') return { main: list[0].name, sub: list[0].buttons ? `${list[0].buttons.length}つのボタン` : undefined }
  if (kind === 'automation') return { main: list.length > 1 ? `${list[0].name} ほか ${list.length}件` : list[0].name, sub: 'LINE に自動で送る物' }
  if (kind === 'booking_menu' && list.length <= 3) return { main: list.map((item) => item.name).join('・') }
  return { main: list.length > 1 ? `${list[0].name} ほか ${list.length}件` : list[0].name }
}

function shortDate(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, '0')}`
}

export default function HqStarterSetsV8() {
  usePageTitle('スタイルの初期セット')
  const role = useStaffRole()
  const canEdit = role === null || canManageRole(role)
  const preparing = usePreparingDialog()
  const [sets, setSets] = useState<HqStarterSet[] | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState<AccountStyle>('restaurant')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await hqStyleSetupApi.listStarterSets()
      if (!res.success) throw new Error('list failed')
      setSets(res.data)
    } catch (caught) {
      setError(describeApiFailure(caught, '読み込み', { scope: 'hq' }))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const rows = ACCOUNT_STYLES.map((style) => ({ id: style, label: styleLabel(style), count: sets ? sets.find((set) => set.style === style)?.accountCount ?? null : null }))
  const set = sets?.find((item) => item.style === active) ?? null
  const groups = useMemo(() => KIND_ROWS.map((row) => ({ ...row, items: (set?.definition.items ?? []).filter((item) => item.kind === row.kind) })).filter((row) => row.items.length > 0), [set])
  const label = styleLabel(active)

  return (
    <ListPage
      boardId="J6647"
      title="スタイルの初期セット"
      help="スタイルごとに、新しいアカウントへ最初から入れる物です。入った物には「見本」の札が付き、店で直せます。"
      actions={canEdit ? <>
        <Button onClick={() => preparing.open('標準に戻す')}>標準に戻す</Button>
        <Button variant="primary" onClick={() => preparing.open('初期セットを作る')}><Plus aria-hidden="true" className={styles.buttonIcon} />初期セットを作る</Button>
      </> : null}
      folders={<FolderPanel heading="スタイル" showHeading rows={rows} activeId={active} onSelect={(id) => setActive(id as AccountStyle)} />}
      folderNav={{ label: 'スタイル', rows, activeId: active, onSelect: (id) => setActive(id as AccountStyle) }}
    >
      <div className={styles.body}>
        {error ? <Notice tone="danger" action={<Button onClick={() => void load()}>もう一度試す</Button>}>{error}</Notice> : null}
        <div className={styles.head}>
          <h3 className={styles.title}>{`${label}の初期セット`}</h3>
          {set?.accountCount !== undefined ? <StatusBadge tone="info" dot>{`${set.accountCount} アカウントで使用中`}</StatusBadge> : null}
          <span className={styles.spacer} />
          {canEdit ? <>
            <Button onClick={() => preparing.open('初期セットの中身を直す')}><Pencil aria-hidden="true" className={styles.buttonIcon} />中身を直す</Button>
            <Button variant="primary" onClick={() => preparing.open('今のアカウントへ配る')}><Send aria-hidden="true" className={styles.buttonIcon} />今のアカウントへ配る</Button>
          </> : null}
        </div>
        <div className={styles.auto}>
          <span className={styles.autoText}>
            <span className={styles.autoTitle}>新しいアカウントで、このスタイルを選んだときに自動で入れる</span>
            <span className={styles.autoNote}>入った物には「見本」の札が付き、店で直せます</span>
          </span>
          {canEdit
            ? <Toggle label="新しいアカウントで自動で入れる" checked={set?.autoInsert ?? true} onChange={() => preparing.open('自動で入れるの切り替え')} />
            : <StatusBadge tone={set?.autoInsert === false ? 'neutral' : 'success'} dot>{set?.autoInsert === false ? '入れない' : '自動で入れる'}</StatusBadge>}
        </div>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>入る物</h3>
          <HelpTip label="入る物の説明">新しいアカウントでこのスタイルを選んだときに入る物です。自動で送る物は止めた状態で入ります。</HelpTip>
        </div>
        {sets === null ? (error ? null : <p className={styles.empty} role="status">読み込んでいます…</p>) : groups.length === 0 ? (
          <p className={styles.empty}>{`${label}の初期セットはまだありません。［初期セットを作る］から作れます。`}</p>
        ) : (
          <div className={styles.table}>
            <GridTable label="入る物" design={{ columns: 'var(--hss-col-kind) minmax(0, 1fr) var(--hss-col-how) var(--hss-col-date) var(--hss-col-menu)', gap: 'var(--polish-space-card)', rowPadding: '0 var(--polish-space-section)', rowHeight: 'var(--hss-row-h)', fontSize: 'var(--text-body)' }}>
              <GridHeadRow>
                <GridCell role="columnheader">種類</GridCell>
                <GridCell role="columnheader">名前</GridCell>
                <GridCell role="columnheader">入り方</GridCell>
                <GridCell role="columnheader">最後に直した</GridCell>
                <GridCell role="columnheader">操作</GridCell>
              </GridHeadRow>
              {groups.map((group) => {
                const name = nameOf(group.items, group.kind)
                const update = set?.updates?.[group.kind]
                return (
                  <GridRow key={group.kind} className={styles.row}>
                    <GridCell>{group.label}</GridCell>
                    <GridCell className={styles.name}>
                      <button type="button" className={styles.nameButton} title={name.main} onClick={() => preparing.open(`${group.label}の中身`)}>{name.main}</button>
                      {name.sub ? <span className={styles.sub}>{name.sub}</span> : null}
                    </GridCell>
                    <GridCell><StatusBadge tone={group.how.tone} dot>{group.how.text}</StatusBadge></GridCell>
                    <GridCell className={styles.date}>{update ? `${shortDate(update.at)} ${update.by}` : '—'}</GridCell>
                    <GridCell>{canEdit ? <RowMenu appearance="box" size="row" label={`${group.label}の操作`} items={[
                      { id: 'edit', label: '中身を直す', onSelect: () => preparing.open(`${group.label}の中身を直す`) },
                      { id: 'remove', label: '初期セットから外す', tone: 'danger', onSelect: () => preparing.open(`${group.label}を初期セットから外す`) },
                    ]} /> : null}</GridCell>
                  </GridRow>
                )
              })}
            </GridTable>
          </div>
        )}
        {groups.some((group) => group.kind === 'automation') && <Notice tone="info" icon={<Info aria-hidden="true" />}>自動で送る物は、店が一度確かめて［動かす］を押すまで送りません。直したあとは［今のアカウントへ配る］で、上書きか新しく作るかを選んで配ります（配る前に確かめの画面が出ます）。統括の無い店には musubo の標準の初期セットが入ります。</Notice>}
      </div>
      {preparing.dialog}
    </ListPage>
  )
}
