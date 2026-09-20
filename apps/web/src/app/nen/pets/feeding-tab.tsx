'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { DeleteAction } from '@/components/shared/row-actions'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { ApiError } from '@/lib/api'
import { nenRanksApi, type NenFeedingData, type NenFeedingKind } from '@/lib/nen-ranks-api'

type Draft = { id: string | null; name: string; kcal: string; isDefault: boolean; kind: NenFeedingKind }
type Status = 'loading' | 'ready' | 'error' | 'forbidden'

const MAX_PRODUCTS = 20

/** 係数の説明（Worker `services/nen-feeding.ts` の ENERGY_FACTORS と同じ値）。 */
const FACTOR_ROWS: Array<{ label: string; dog: string; cat: string }> = [
  { label: '子犬・子猫（4か月未満）', dog: '3.0', cat: '2.5' },
  { label: '子犬・子猫（12か月未満）', dog: '2.0', cat: '2.5' },
  { label: '成犬・成猫（避妊去勢済み）', dog: '1.6', cat: '1.2' },
  { label: '成犬・成猫（していない）', dog: '1.8', cat: '1.4' },
  { label: 'シニア（犬 7歳〜／猫 11歳〜、避妊去勢済み）', dog: '1.4', cat: '1.1' },
  { label: 'シニア（していない）', dog: '1.6', cat: '1.3' },
  { label: '活動量「多め」「少なめ」', dog: '±0.2', cat: '±0.1' },
]

/**
 * 主食のカロリー タブ。★V6 37-3-A（`HVnzL`）マイペットの2つ目のタブ。
 *
 * 主食の「100g あたり kcal」を商品ごとに持つ。マイページ「今日の目安」（★V6 37-2）のグラム数はここから決まる。
 * 左：主食の表（商品名・kcal・既定）。右：計算のしかた（NRC／FEDIAF の式と係数。表示だけ）。
 * 保存は下部追従バー（`docs/v6-common-rules.md` §1-6）。
 */
export default function FeedingTab({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<NenFeedingData | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [treatLimit, setTreatLimit] = useState('10')
  /** 表示中データ・下書きがどのアカウントのものか。編集状態はアカウントに固定する（DEEP-22）。 */
  const [dataAccountId, setDataAccountId] = useState(accountId)
  /** 要求世代。切替・再取得で進め、遅れて届いた古い応答を捨てる。 */
  const generationRef = useRef(0)

  /*
   * アカウントが切り替わった瞬間に、表示データと編集状態をまとめて初期化する。
   * ここで残すと、Bの読み込み中にAのフォームと保存が有効のままになり、
   * Aの商品（AのID）をBへ保存できてしまう。世代も進めて飛行中の応答を失効させる。
   */
  if (dataAccountId !== accountId) {
    const hadUnsaved = dirty
    generationRef.current += 1
    setDataAccountId(accountId)
    setData(null)
    setDrafts([])
    setTreatLimit('10')
    setDirty(false)
    setError('')
    setNotice(hadUnsaved ? 'LINEアカウントを切り替えたため、保存していない変更は破棄しました。' : '')
    setStatus('loading')
  }

  const fromData = (next: NenFeedingData): Draft[] =>
    next.products.map((p) => ({ id: p.id, name: p.name, kcal: String(p.kcalPer100g), isDefault: p.isDefault, kind: p.kind === 'nen' ? 'nen' : 'staple' }))

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    const account = accountId
    setStatus('loading')
    try {
      const res = await nenRanksApi.feeding(account)
      if (!res.success) throw new Error(res.error)
      // 要求世代を照合する。切替後に届いた別アカウントの応答は捨てる（逆順応答も混ざらない）。
      if (generationRef.current !== generation) return
      setData(res.data)
      setDrafts(fromData(res.data))
      setTreatLimit(String(res.data.treatLimitPercent ?? 10))
      setDirty(false)
      setStatus('ready')
    } catch (caught) {
      if (generationRef.current !== generation) return
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const update = (index: number, patch: Partial<Draft>) => {
    setDrafts((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setDirty(true)
    setNotice('')
  }
  // 既定（主食）・目安に使う（然の商品）は、それぞれの種類で1つだけ。
  const setDefault = (index: number) => {
    setDrafts((current) => current.map((row, i) => (row.kind === current[index].kind ? { ...row, isDefault: i === index } : row)))
    setDirty(true)
  }
  const remove = (index: number) => {
    setDrafts((current) => {
      const removed = current[index]
      const next = current.filter((_, i) => i !== index)
      const first = next.findIndex((row) => row.kind === removed.kind)
      if (first >= 0 && !next.some((row) => row.kind === removed.kind && row.isDefault)) next[first] = { ...next[first], isDefault: true }
      return next
    })
    setDirty(true)
  }
  const add = (kind: NenFeedingKind) => {
    setDrafts((current) => [...current, { id: null, name: '', kcal: '', isDefault: !current.some((row) => row.kind === kind), kind }])
    setDirty(true)
  }
  const changeTreatLimit = (value: string) => {
    setTreatLimit(value)
    setDirty(true)
    setNotice('')
  }
  const cancel = () => {
    if (data) { setDrafts(fromData(data)); setTreatLimit(String(data.treatLimitPercent ?? 10)) }
    setDirty(false)
    setError('')
  }

  const save = async () => {
    // 取得中や別アカウントの下書きは保存しない。保存先は下書きの載ったアカウントに固定（DEEP-22）。
    if (status !== 'ready' || dataAccountId !== accountId) return
    const generation = generationRef.current
    const account = accountId
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await nenRanksApi.saveFeeding(account, drafts.map((row) => ({
        id: row.id, name: row.name.trim(), kcalPer100g: Number(row.kcal.replace(/[,，]/g, '')), isDefault: row.isDefault, kind: row.kind,
      })), Number(treatLimit))
      if (!res.success) throw new Error(res.error)
      // 保存応答も世代を照合する。切替後に届いたAの応答をBの画面へ置かない。
      if (generationRef.current !== generation) return
      setData(res.data)
      setDrafts(fromData(res.data))
      setTreatLimit(String(res.data.treatLimitPercent ?? 10))
      setDirty(false)
      setNotice(res.data.refreshedPets
        ? `主食を保存し、登録済みのペット ${res.data.refreshedPets.toLocaleString('ja-JP')}頭の目安を計算し直しました。`
        : '主食を保存しました。')
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '保存できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const noticeEl = notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null
  if (status === 'loading' && !data) return <>{noticeEl}<ListState kind="loading" title="主食のカロリー表を読み込んでいます" /></>
  if (status === 'forbidden') return <ListState kind="forbidden" />
  if (status === 'error') return <ListState kind="error" title="主食のカロリー表を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
  // アカウント切替直後：次の取得が終わるまで読み込み表示にする。旧アカウントの表は出さない。
  if (!data) return <>{noticeEl}<ListState kind="loading" title="主食のカロリー表を読み込んでいます" /></>

  return (
    <>
      <div data-design="Note" data-design-node="feeding-note">
        <NoteBar tone="info">
          マイページの「今日の目安」は、1日の必要カロリーを「主食」の kcal で割ってグラムにします。「然の鹿肉の目安」は、必要カロリー × おやつの上限（%）を然の商品の kcal で割ります。主食が1つも無いと、目安は kcal だけの表示になります。
        </NoteBar>
      </div>

      {notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null}
      {error ? <p className="text-label text-status-danger" role="alert">{error}</p> : null}

      <div data-design="Body" data-design-node="feeding-body" className="grid gap-4 xl:grid-cols-3">
        <div data-design="Tables" data-design-node="feeding-tables" className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <ProductTable
            kind="staple"
            title="主食（お客様が選ぶ、ふだんのごはん）"
            description="一般的な種類だけ登録します。マイページの「いつもの主食」で選ばれ、1日の目安（g）はこの kcal で割ります。"
            defaultLabel="既定の主食" defaultChip="既定" makeDefault="既定にする" addLabel="＋ 主食を追加" namePlaceholder="例：ドライフード（成犬・成猫用／総合栄養食）" kcalPlaceholder="360"
            emptyTitle="まだ主食が登録されていません" emptyDescription="お客様が選ぶ一般的なフードの種類と、100g あたりのカロリーを登録してください。"
            drafts={drafts} onUpdate={update} onDefault={setDefault} onRemove={remove} onAdd={() => add('staple')} disabledAdd={drafts.length >= MAX_PRODUCTS}
          />
          <ProductTable
            kind="nen"
            title="然の商品（おやつ・トッピング）"
            description="マイページの「然の鹿肉の目安」は、1日の必要カロリー × おやつの上限（%）を、「目安に使う」然の商品の kcal で割ります。"
            defaultLabel="目安に使う商品" defaultChip="使う" makeDefault="これを使う" addLabel="＋ 然の商品を追加" namePlaceholder="例：然 鹿肉ジャーキー" kcalPlaceholder="300"
            emptyTitle="まだ然の商品が登録されていません" emptyDescription="然の商品名と、100g あたりのカロリーを登録すると「然の鹿肉の目安」が出ます。"
            drafts={drafts} onUpdate={update} onDefault={setDefault} onRemove={remove} onAdd={() => add('nen')} disabledAdd={drafts.length >= MAX_PRODUCTS}
          />
          <section data-design="TreatLimit" data-design-node="feeding-treat-limit" className="flex flex-wrap items-center gap-4 rounded-card border border-hairline bg-canvas px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-label font-bold text-ink">おやつの上限（1日の必要カロリーに対して）</h2>
              <p className="mt-1 text-caption text-ink-secondary">獣医師の一般的な目安は 10% 以内。上限を変えると、全員の「然の鹿肉の目安」が計算し直されます。</p>
            </div>
            <span className="flex w-32 items-center gap-2">
              <TextField aria-label="おやつの上限（%）" inputMode="numeric" value={treatLimit} onChange={(event) => changeTreatLimit(event.target.value)} />
              <span className="shrink-0 text-caption font-semibold text-ink-faint">%</span>
            </span>
          </section>
        </div>

        <div data-design="Side" data-design-node="feeding-side" className="flex flex-col gap-4">
          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
            <h2 className="text-body font-bold text-ink">計算のしかた</h2>
            <p className="mt-2 text-caption text-ink-secondary">公的な指針（NRC／FEDIAF）の式をそのまま使います。</p>
            <dl className="mt-3 flex flex-col gap-2">
              <FormulaRow label="安静時エネルギー" value="70 × 体重(kg) の 0.75 乗" />
              <FormulaRow label="1日の必要カロリー" value="安静時エネルギー × 係数" />
              <FormulaRow label="1日の目安（g）" value="必要カロリー ÷ 主食の kcal/100g × 100" />
              <FormulaRow label="然の鹿肉の目安（g）" value="必要カロリー × 上限% ÷ 然商品の kcal/100g × 100" />
            </dl>
            <dl className="mt-4 flex flex-col">
              <div className="flex items-center gap-2 pb-1 text-caption font-semibold text-ink-faint">
                <dt className="flex-1">係数</dt>
                <dd className="w-12 text-right">犬</dd>
                <dd className="w-12 text-right">猫</dd>
              </div>
              {FACTOR_ROWS.map((row) => (
                <div key={row.label} className="flex items-center gap-2 border-t border-hairline py-1.5 text-caption text-ink-secondary">
                  <dt className="flex-1">{row.label}</dt>
                  <dd className="w-12 text-right tabular-nums">{row.dog}</dd>
                  <dd className="w-12 text-right tabular-nums">{row.cat}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro text-ink-faint">避妊去勢が未回答のときは「済み」の係数で少なめに見積もります。体型や体調で前後するため、画面には「参考値」と表示します。</p>
          </section>
          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
            <h2 className="text-body font-bold text-ink">登録済みのペット</h2>
            <p className="mt-2 text-heading font-bold tabular-nums text-ink">{data.petCount.toLocaleString('ja-JP')}<span className="ml-1 text-caption font-semibold text-ink-faint">頭</span></p>
            <p className="mt-1 text-micro text-ink-faint">保存すると、この全員の目安（主食・然の鹿肉）が計算し直されます。</p>
          </section>
        </div>
      </div>

      <StickyBar
        status={dirty ? '保存していない変更があります' : undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={cancel} disabled={busy || !dirty || status !== 'ready'}>キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty || status !== 'ready' || dataAccountId !== accountId}>保存する</Button>
          </>
        )}
      />
    </>
  )
}

function FormulaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption font-semibold text-ink-secondary">{label}</dt>
      <dd className="rounded-control border border-hairline bg-canvas px-3 py-2 text-label font-semibold text-ink">{value}</dd>
    </div>
  )
}

function ProductTable({
  kind, title, description, defaultLabel, defaultChip, makeDefault, addLabel, namePlaceholder, kcalPlaceholder, emptyTitle, emptyDescription,
  drafts, onUpdate, onDefault, onRemove, onAdd, disabledAdd,
}: {
  kind: NenFeedingKind
  title: string
  description: string
  defaultLabel: string
  defaultChip: string
  makeDefault: string
  addLabel: string
  namePlaceholder: string
  kcalPlaceholder: string
  emptyTitle: string
  emptyDescription: string
  drafts: Draft[]
  onUpdate: (index: number, patch: Partial<Draft>) => void
  onDefault: (index: number) => void
  onRemove: (index: number) => void
  onAdd: () => void
  disabledAdd: boolean
}) {
  const rows = drafts.map((row, index) => ({ row, index })).filter(({ row }) => row.kind === kind)
  return (
    <section data-design="Table" data-design-node={`feeding-table-${kind}`} className="flex min-w-0 flex-col gap-2">
      <div>
        <h2 className="text-label font-bold text-ink">{title}</h2>
        <p className="mt-1 text-caption text-ink-secondary">{description}</p>
      </div>
      {rows.length === 0 ? (
        <ListState kind="empty" title={emptyTitle} description={emptyDescription} action={<Button variant="primary" onClick={onAdd} disabled={disabledAdd}>{addLabel.replace('＋ ', '')}</Button>} />
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th>商品名</Th>
              <Th className="w-44">100g あたり</Th>
              <Th className="w-32">{defaultLabel}</Th>
              <Th className="w-14" align="right"><span className="sr-only">削除</span></Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {rows.map(({ row, index }) => (
              <Tr key={row.id ?? `new-${index}`}>
                <Td>
                  <TextField aria-label={`商品名 ${index + 1}`} value={row.name} maxLength={40} placeholder={namePlaceholder} onChange={(event) => onUpdate(index, { name: event.target.value })} />
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <TextField aria-label={`100gあたりのカロリー ${index + 1}`} inputMode="decimal" value={row.kcal} placeholder={kcalPlaceholder} onChange={(event) => onUpdate(index, { kcal: event.target.value })} />
                    <span className="shrink-0 text-caption font-semibold text-ink-faint">kcal</span>
                  </span>
                </Td>
                <Td>
                  {row.isDefault ? (
                    <Chip tone="ok">{defaultChip}</Chip>
                  ) : (
                    <button type="button" className="text-label font-semibold text-accent-deep" onClick={() => onDefault(index)}>{makeDefault}</button>
                  )}
                </Td>
                <Td align="right">
                  <DeleteAction label={`${row.name || 'この商品'}を削除する`} onClick={() => onRemove(index)} />
                </Td>
              </Tr>
            ))}
            <Tr>
              <Td colSpan={4}>
                <button type="button" className="text-label font-semibold text-accent-deep" onClick={onAdd} disabled={disabledAdd}>
                  {addLabel}
                </button>
              </Td>
            </Tr>
          </tbody>
        </DataTable>
      )}
    </section>
  )
}
