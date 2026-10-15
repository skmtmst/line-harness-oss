'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, Pencil, Plus, Send } from 'lucide-react'
import Button from '@/components/shared/button'
import FolderPanel from '@/components/shared/folder-panel'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { Tabs } from '@/components/shared/tabs'
import { hqTemplateTabsForStarterSets } from '@/v8/hq-templates/store-list'
import { RowMenu } from '@/components/shared/row-actions'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { ListPage } from '@/components/templates'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import type { AccountStyle, StyleTemplateSample } from '@line-crm/shared'
import Dialog from '@/components/shared/dialog'
import { hqStyleApi, type StarterSetItem, type StyleStarterSet } from '@/lib/api-styles'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { notifySaved } from '@/components/shared/toast'
import { STYLE_CHOICES, styleLabel } from '@/v8/onboarding/model'
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

export default function HqStarterSetsV8() {
  usePageTitle('スタイルの初期セット')
  const role = useStaffRole()
  const canEdit = role === null || canManageRole(role)
  const preparing = usePreparingDialog()
  const [sets, setSets] = useState<StyleStarterSet[] | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState<AccountStyle>('restaurant')
  const [removing, setRemoving] = useState<StarterSetItem['kind'] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  /* テンプレートの見本（B-311 追記4・組4 hqStyleApi.templateSamples）。業種を替えたら読み直す。 */
  const [samples, setSamples] = useState<StyleTemplateSample[] | null>(null)
  const [samplesError, setSamplesError] = useState(false)
  const [sampleOpen, setSampleOpen] = useState<StyleTemplateSample | null>(null)
  const [samplesTick, setSamplesTick] = useState(0)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await hqStyleApi.listStarterSets()
      if (!res.success) throw new Error('list failed')
      setSets(res.data)
    } catch (caught) {
      setError(describeApiFailure(caught, '読み込み', { scope: 'hq' }))
    }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let cancelled = false
    setSamples(null)
    setSamplesError(false)
    void hqStyleApi.templateSamples(active).then((res) => { if (!cancelled && res.success) setSamples(res.data.items) }).catch(() => { if (!cancelled) setSamplesError(true) })
    return () => { cancelled = true }
  }, [active, samplesTick])

  /* 使っているアカウントの数は口が返さない（API-CONTRACT-4 §10）。数は出さない。 */
  const rows = STYLE_CHOICES.map(({ value: style }) => ({ id: style, label: styleLabel(style), count: null }))
  const set = sets?.find((item) => item.style === active) ?? null
  const groups = useMemo(() => KIND_ROWS.map((row) => ({ ...row, items: (set?.definition.items ?? []).filter((item) => item.kind === row.kind) })).filter((row) => row.items.length > 0), [set])
  const label = styleLabel(active)

  /* 統括の初期セットから種類ごと外す（版つきで保存。ぶつかったら読み直してもらう）。 */
  const removeKind = async () => {
    if (!set || !removing) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await hqStyleApi.saveStarterSet(set.style, { expectedVersion: set.version, name: set.name, definition: { items: set.definition.items.filter((item) => item.kind !== removing) } })
      if (!res.success) throw new Error('save failed')
      notifySaved('初期セットから外しました')
      setRemoving(null)
      await load()
    } catch (caught) {
      setSaveError(describeApiFailure(caught, '保存', { scope: 'hq' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ListPage
      boardId="J6647"
      title="スタイルの初期セット"
      tabs={<Tabs size="compact" label="テンプレートの種類" items={hqTemplateTabsForStarterSets()} />}
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
          {set ? <StatusBadge tone="info" dot>統括の初期セット</StatusBadge> : <StatusBadge tone="neutral" dot>musubo の標準</StatusBadge>}
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
          {/* 新しいアカウントへは必ず入る（口に切り替えが無い）。押せないスイッチは置かず、状態の札で出す。 */}
          <StatusBadge tone="success" dot>自動で入れる</StatusBadge>
        </div>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>入る物</h3>
          <HelpTip label="入る物の説明">新しいアカウントでこのスタイルを選んだときに入る物です。自動で送る物は止めた状態で入ります。</HelpTip>
        </div>
        {sets === null ? (error ? null : <p className={styles.empty} role="status">読み込んでいます…</p>) : groups.length === 0 ? (
          <p className={styles.empty}>{`${label}の初期セットはまだありません。［初期セットを作る］から作れます。`}</p>
        ) : (
          <div className={styles.table}>
            <GridTable label="入る物" design={{ columns: 'var(--hss-col-kind) minmax(0, 1fr) var(--hss-col-how) var(--hss-col-menu)', gap: 'var(--polish-space-card)', rowPadding: '0 var(--polish-space-section)', rowHeight: 'var(--hss-row-h)', fontSize: 'var(--text-body)' }}>
              <GridHeadRow>
                <GridCell role="columnheader">種類</GridCell>
                <GridCell role="columnheader">名前</GridCell>
                <GridCell role="columnheader">入り方</GridCell>
                <GridCell role="columnheader">操作</GridCell>
              </GridHeadRow>
              {groups.map((group) => {
                const name = nameOf(group.items, group.kind)
                return (
                  <GridRow key={group.kind} className={styles.row}>
                    <GridCell>{group.label}</GridCell>
                    <GridCell className={styles.name}>
                      <button type="button" className={styles.nameButton} title={name.main} onClick={() => preparing.open(`${group.label}の中身`)}>{name.main}</button>
                      {name.sub ? <span className={styles.sub}>{name.sub}</span> : null}
                    </GridCell>
                    <GridCell><StatusBadge tone={group.how.tone} dot>{group.how.text}</StatusBadge></GridCell>
                    <GridCell>{canEdit ? <RowMenu appearance="box" size="row" label={`${group.label}の操作`} items={[
                      { id: 'edit', label: '中身を直す', onSelect: () => preparing.open(`${group.label}の中身を直す`) },
                      ...(set ? [{ id: 'remove', label: '初期セットから外す', tone: 'danger' as const, onSelect: () => { setSaveError(''); setRemoving(group.kind) } }] : []),
                    ]} /> : null}</GridCell>
                  </GridRow>
                )
              })}
            </GridTable>
          </div>
        )}
        {groups.some((group) => group.kind === 'automation') && <Notice tone="info" icon={<Info aria-hidden="true" />}>自動で送る物は、店が一度確かめて［動かす］を押すまで送りません。直したあとは［今のアカウントへ配る］で、上書きか新しく作るかを選んで配ります（配る前に確かめの画面が出ます）。統括の無い店には musubo の標準の初期セットが入ります。</Notice>}
        <section className={styles.samples} aria-labelledby="hss-samples">
          <div className={styles.sectionHead}>
            <h3 id="hss-samples" className={styles.sectionTitle}>テンプレートの見本</h3>
            <HelpTip label="テンプレートの見本の説明">この業種で新しいアカウントに「【見本】」の名前で入るメッセージです。差し込み（名前・日時・店名・URL）は送る前に入れます。</HelpTip>
            <span className={styles.spacer} />
            {samples ? <span className={styles.sampleCount}>{`${samples.length}件`}</span> : null}
          </div>
          {samplesError ? <Notice tone="danger" action={<Button onClick={() => setSamplesTick((value) => value + 1)}>もう一度試す</Button>}>見本を読み込めませんでした。</Notice> : samples === null ? <p className={styles.empty} role="status">読み込んでいます…</p> : (
            <div className={styles.table}>
              <GridTable label="テンプレートの見本" design={{ columns: 'minmax(0, 1fr) var(--hss-col-kind) var(--hss-col-kind) var(--hss-col-open)', gap: 'var(--polish-space-card)', rowPadding: '0 var(--polish-space-section)', fontSize: 'var(--text-body)' }}>
                <GridHeadRow>
                  <GridCell role="columnheader">名前</GridCell>
                  <GridCell role="columnheader">種類</GridCell>
                  <GridCell role="columnheader">差し込み</GridCell>
                  <GridCell role="columnheader">操作</GridCell>
                </GridHeadRow>
                {samples.map((sample) => (
                  <GridRow key={sample.key} className={styles.sampleRow}>
                    <GridCell className={styles.name}><span className={styles.sampleName} title={sample.name}>{sample.name}</span></GridCell>
                    <GridCell>{sample.category === 'common' ? '共通' : styleLabel(sample.category)}</GridCell>
                    <GridCell>{sample.placeholders.length ? `${sample.placeholders.length}つ` : 'なし'}</GridCell>
                    <GridCell><Button size="compact" onClick={() => setSampleOpen(sample)}>中身を見る</Button></GridCell>
                  </GridRow>
                ))}
              </GridTable>
            </div>
          )}
        </section>
      </div>
      <Dialog open={sampleOpen !== null} title={sampleOpen?.name ?? ''} description={sampleOpen?.preparation} size="medium" onCancel={() => setSampleOpen(null)}>
        {sampleOpen ? (
          <div className={styles.sampleBody}>
            <p className={styles.sampleText}>{sampleOpen.text}</p>
            {sampleOpen.placeholders.length ? (
              <ul className={styles.placeholders} aria-label="差し込み">
                {sampleOpen.placeholders.map((item) => <li key={item.token}><StatusBadge tone={item.requiresConfiguration ? 'warning' : 'neutral'} dot>{item.label}</StatusBadge></li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Dialog>
      {preparing.dialog}
      <ConfirmDialog
        open={removing !== null}
        title="初期セットから外しますか？"
        description={`これから新しく作るアカウントには「${KIND_ROWS.find((row) => row.kind === removing)?.label ?? ''}」が入らなくなります。今あるアカウントの中身は変わりません。`}
        confirmLabel="外す"
        destructive
        busy={saving}
        busyLabel="外しています…"
        error={saveError}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void removeKind()}
      />
    </ListPage>
  )
}
