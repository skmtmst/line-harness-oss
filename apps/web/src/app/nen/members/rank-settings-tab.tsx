'use client'

import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { DeleteAction } from '@/components/shared/row-actions'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { formatJstDateTime } from '@/lib/presentation'
import { nenRanksApi, type NenRankSettingsData } from '@/lib/nen-ranks-api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import type { LoadStatus } from './page'

type Draft = { id: string | null; name: string; threshold: string; rate: string; tagName: string | null; memberCount: number }

const RULE_LABELS = {
  yearStartMonth: (month: number) => (month === 1 ? '1月1日〜12月31日' : `${month}月1日〜翌年${month - 1}月末`),
  applyOnReach: 'すぐに反映する',
  keepUntil: '翌年の12月末まで',
  countOrders: '入金済みの注文（キャンセル・返金は除く）',
} as const

/**
 * ランク設定タブ。★V6 37-1-A（`p7xHl`）。
 *
 * 左：ランクの表（名前・通年のしきい値・マイル還元・自動で付くタグ・会員数）。
 * 右：ランクの決まり方（今回は表示だけ。値は固定）と、ECとの同期状態。
 * 保存は下部追従バー（`docs/v6-common-rules.md` §1-6：保存はここにしか置かない）。
 */
export default function RankSettingsTab({
  accountId,
  status,
  settings,
  onSaved,
  onRetry,
}: {
  accountId: string
  status: LoadStatus
  settings: NenRankSettingsData | null
  /** 保存応答の反映先を指定する。別アカウントへ切り替わっていれば親が捨てる。 */
  onSaved: (forAccountId: string, next: NenRankSettingsData) => void
  onRetry: () => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 下書きがどのアカウントのものか。編集状態はアカウントに固定する（DEEP-21）。 */
  const [draftAccountId, setDraftAccountId] = useState(accountId)

  /*
   * 未保存の変更がある間、画面を離れる操作を止める共通の番兵（DETAIL-04系）。
   * 左メニュー・画面内リンク・戻る操作・再読込を同じ確認対話へ寄せる。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  /*
   * アカウントが切り替わった瞬間に編集状態を捨てる。
   * dirtyのまま残すと、Aの下書き（AのIDと編集内容）がBの保存へ乗る。
   * 切替前に未保存の変更があったときは、黙って消さず破棄したことを画面へ出す。
   */
  if (draftAccountId !== accountId) {
    const hadUnsaved = dirty
    setDraftAccountId(accountId)
    setDrafts([])
    setDirty(false)
    setError('')
    cancelLeave()
    setNotice(hadUnsaved ? 'LINEアカウントを切り替えたため、保存していない変更は破棄しました。' : '')
  }

  useEffect(() => {
    if (!settings || dirty) return
    setDrafts(settings.ranks.map((rank) => ({
      id: rank.id, name: rank.name, threshold: String(rank.annualThresholdYen), rate: String(rank.mileRatePercent), tagName: rank.tagName, memberCount: rank.memberCount,
    })))
  }, [settings, dirty])

  const update = (index: number, patch: Partial<Draft>) => {
    setDrafts((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setDirty(true)
    setNotice('')
  }
  const remove = (index: number) => {
    setDrafts((current) => current.filter((_, i) => i !== index))
    setDirty(true)
  }
  const add = () => {
    setDrafts((current) => [...current, { id: null, name: '', threshold: '', rate: '', tagName: null, memberCount: 0 }])
    setDirty(true)
  }
  const cancel = () => {
    setDirty(false)
    setError('')
    if (settings) {
      setDrafts(settings.ranks.map((rank) => ({
        id: rank.id, name: rank.name, threshold: String(rank.annualThresholdYen), rate: String(rank.mileRatePercent), tagName: rank.tagName, memberCount: rank.memberCount,
      })))
    }
  }

  const save = async () => {
    // 編集元と保存先のアカウントが一致するときだけ送る（DEEP-21）。
    if (draftAccountId !== accountId) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await nenRanksApi.saveRanks(accountId, drafts.map((row) => ({
        id: row.id,
        name: row.name.trim(),
        annualThresholdYen: Number(row.threshold.replace(/[,，]/g, '')),
        mileRatePercent: Number(row.rate),
      })))
      if (!res.success) throw new Error(res.error)
      setDirty(false)
      onSaved(accountId, res.data)
      setNotice(res.data.sync?.status === 'synced'
        ? 'ランク設定を保存し、ECへ同期しました。友だち属性のタグも付け替えています。'
        : 'ランク設定を保存しました。ECへの同期は失敗したので、右の「もう一度同期」で送り直せます。')
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '保存できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const resync = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await nenRanksApi.resync(accountId)
      if (!res.success) throw new Error(res.error)
      onSaved(accountId, res.data)
      setNotice(res.data.sync?.status === 'synced' ? 'ECへ同期しました。' : `ECへの同期に失敗しました：${res.data.sync?.error ?? ''}`)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '同期できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const noticeEl = notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null
  if (status === 'loading' && !settings) return <>{noticeEl}<ListState kind="loading" title="ランク設定を読み込んでいます" /></>
  if (status === 'forbidden') return <ListState kind="forbidden" />
  if (status === 'error') return <ListState kind="error" title="ランク設定を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={onRetry} />
  // アカウント切替直後：settings は選択中アカウントのものだけが来る。次の取得が終わるまで読み込み表示にする。
  if (!settings) return <>{noticeEl}<ListState kind="loading" title="ランク設定を読み込んでいます" /></>

  const rules = settings.rules

  return (
    <>
      <div data-design="Note" data-design-node="CmAMb">
        <NoteBar tone="info">
          通年（1月1日〜12月31日の購入額）でランクが決まります。保存するとECへ同期され、次のお買い物からマイル還元が変わります。
        </NoteBar>
      </div>

      {notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null}
      {error ? <p className="text-label text-status-danger" role="alert">{error}</p> : null}

      <div data-design="Body" data-design-node="Y4zWdG" className="grid gap-4 xl:grid-cols-3">
        <section data-design="Table" data-design-node="C0WaS" className="min-w-0 xl:col-span-2">
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th className="w-52">ランク名</Th>
                <Th className="w-48">通年のしきい値</Th>
                <Th className="w-32">マイル還元</Th>
                <Th>友だち属性タグ</Th>
                <Th className="w-24" align="right">会員数</Th>
                <Th className="w-14" align="right"><span className="sr-only">削除</span></Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {drafts.map((row, index) => {
                const isBase = index === 0 && row.threshold.replace(/[,，]/g, '') === '0'
                return (
                  <Tr key={row.id ?? `new-${index}`}>
                    <Td>
                      <TextField aria-label={`ランク名 ${index + 1}`} value={row.name} maxLength={20} onChange={(event) => update(index, { name: event.target.value })} />
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <TextField aria-label={`しきい値 ${index + 1}`} inputMode="numeric" value={row.threshold} onChange={(event) => update(index, { threshold: event.target.value })} disabled={isBase} />
                        <span className="shrink-0 text-caption font-semibold text-ink-faint">円〜</span>
                      </span>
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <TextField aria-label={`マイル還元 ${index + 1}`} inputMode="decimal" value={row.rate} onChange={(event) => update(index, { rate: event.target.value })} />
                        <span className="shrink-0 text-caption font-semibold text-ink-faint">%</span>
                      </span>
                    </Td>
                    <Td>
                      <span className="block truncate text-label text-ink-secondary" title={row.tagName ?? ''}>
                        {row.tagName ?? (row.name.trim() ? `[会員] ランク：${row.name.trim()}（保存すると作られます）` : '—')}
                      </span>
                    </Td>
                    <Td align="right"><span className="text-label font-semibold tabular-nums text-ink">{row.memberCount.toLocaleString('ja-JP')}人</span></Td>
                    <Td align="right">
                      {isBase ? null : <DeleteAction label={`${row.name || 'このランク'}を削除する`} onClick={() => remove(index)} />}
                    </Td>
                  </Tr>
                )
              })}
              <Tr>
                <Td colSpan={6}>
                  <button type="button" className="text-label font-semibold text-action" onClick={add} disabled={drafts.length >= 8}>
                    ＋ ランクを追加
                  </button>
                </Td>
              </Tr>
            </tbody>
          </DataTable>
        </section>

        <div data-design="Side" data-design-node="RgQEL" className="flex flex-col gap-4">
          <section data-design-node="luziY" className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
            <h2 className="text-body font-bold text-ink">ランクの決まり方</h2>
            <dl className="mt-3 flex flex-col gap-3">
              <RuleRow label="通年の区切り" value={RULE_LABELS.yearStartMonth(rules?.yearStartMonth ?? 1)} />
              <RuleRow label="上がったとき" value={RULE_LABELS.applyOnReach} />
              <RuleRow label="維持する期間" value={RULE_LABELS.keepUntil} />
              <RuleRow label="集計に含める注文" value={RULE_LABELS.countOrders} />
            </dl>
          </section>
          <section data-design-node="vMRJs" className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
            <h2 className="text-body font-bold text-ink">ECとの同期</h2>
            <div className="mt-2 flex items-center gap-2">
              {rules?.syncStatus === 'synced' ? <Chip tone="ok">同期済み</Chip> : rules?.syncStatus === 'failed' ? <Chip tone="danger">失敗</Chip> : <Chip tone="warn">未同期</Chip>}
              <span className="text-caption text-ink-secondary">
                {rules?.syncStatus === 'synced' && rules.syncedAt ? `${formatJstDateTime(rules.syncedAt)} に反映` : rules?.syncStatus === 'failed' ? rules.syncError ?? '理由は記録されていません' : 'まだECへ送っていません'}
              </span>
            </div>
            <p className="mt-2 text-micro text-ink-faint">ランクとマイルの計算はEC側で行い、結果がここへ届きます。同期に失敗したときは、この場所に理由が表示されます。</p>
            <div className="mt-3">
              <Button variant="secondary" onClick={() => void resync()} disabled={busy || dirty}>
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                もう一度同期
              </Button>
            </div>
          </section>
        </div>
      </div>

      <StickyBar
        status={dirty ? '保存していない変更があります' : rules ? `版 ${rules.version}` : undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={cancel} disabled={busy || !dirty}>キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty}>保存してECへ同期</Button>
          </>
        )}
      />

      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない変更があります"
        description="このまま移動すると、ランク設定への変更は失われます。保存せずに移動しますか？"
        confirmLabel="保存せずに移動"
        cancelLabel="編集を続ける"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </>
  )
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption font-semibold text-ink-secondary">{label}</dt>
      <dd className="rounded-control border border-hairline bg-canvas px-3 py-2 text-label font-semibold text-ink">{value}</dd>
    </div>
  )
}
