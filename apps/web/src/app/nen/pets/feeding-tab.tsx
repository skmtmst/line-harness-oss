'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { DeleteAction } from '@/components/shared/row-actions'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { ApiError } from '@/lib/api'
import { nenRanksApi, type NenFeedingData } from '@/lib/nen-ranks-api'

type Draft = { id: string | null; name: string; kcal: string; isDefault: boolean }
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

  const fromData = (next: NenFeedingData): Draft[] =>
    next.products.map((p) => ({ id: p.id, name: p.name, kcal: String(p.kcalPer100g), isDefault: p.isDefault }))

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await nenRanksApi.feeding(accountId)
      if (!res.success) throw new Error(res.error)
      setData(res.data)
      setDrafts(fromData(res.data))
      setDirty(false)
      setStatus('ready')
    } catch (caught) {
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
  const setDefault = (index: number) => {
    setDrafts((current) => current.map((row, i) => ({ ...row, isDefault: i === index })))
    setDirty(true)
  }
  const remove = (index: number) => {
    setDrafts((current) => {
      const next = current.filter((_, i) => i !== index)
      if (next.length > 0 && !next.some((row) => row.isDefault)) next[0] = { ...next[0], isDefault: true }
      return next
    })
    setDirty(true)
  }
  const add = () => {
    setDrafts((current) => [...current, { id: null, name: '', kcal: '', isDefault: current.length === 0 }])
    setDirty(true)
  }
  const cancel = () => {
    if (data) setDrafts(fromData(data))
    setDirty(false)
    setError('')
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await nenRanksApi.saveFeeding(accountId, drafts.map((row) => ({
        id: row.id, name: row.name.trim(), kcalPer100g: Number(row.kcal.replace(/[,，]/g, '')), isDefault: row.isDefault,
      })))
      if (!res.success) throw new Error(res.error)
      setData(res.data)
      setDrafts(fromData(res.data))
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

  if (status === 'loading' && !data) return <ListState kind="loading" title="主食のカロリー表を読み込んでいます" />
  if (status === 'forbidden') return <ListState kind="forbidden" />
  if (status === 'error' || !data) return <ListState kind="error" title="主食のカロリー表を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />

  return (
    <>
      <div data-design="Note" data-design-node="feeding-note">
        <NoteBar tone="info">
          マイページの「今日の目安」は、体重・年齢・避妊去勢・活動量から1日の必要カロリーを出し、ここに登録した主食の kcal で割ってグラムにします。主食が1つも無いと、目安は kcal だけの表示になります。
        </NoteBar>
      </div>

      {notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null}
      {error ? <p className="text-label text-status-danger" role="alert">{error}</p> : null}

      <div data-design="Body" data-design-node="feeding-body" className="grid gap-4 xl:grid-cols-3">
        <section data-design="Table" data-design-node="feeding-table" className="min-w-0 xl:col-span-2">
          {drafts.length === 0 ? (
            <ListState kind="empty" title="まだ主食が登録されていません" description="然の主食商品と、100g あたりのカロリーを登録してください。" action={<Button variant="primary" onClick={add}>主食を追加</Button>} />
          ) : (
            <DataTable>
              <thead>
                <TableHeadRow>
                  <Th>商品名</Th>
                  <Th className="w-44">100g あたり</Th>
                  <Th className="w-28">既定の主食</Th>
                  <Th className="w-14" align="right"><span className="sr-only">削除</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {drafts.map((row, index) => (
                  <Tr key={row.id ?? `new-${index}`}>
                    <Td>
                      <TextField aria-label={`商品名 ${index + 1}`} value={row.name} maxLength={40} placeholder="例：鹿肉ミンチ" onChange={(event) => update(index, { name: event.target.value })} />
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <TextField aria-label={`100gあたりのカロリー ${index + 1}`} inputMode="decimal" value={row.kcal} placeholder="120" onChange={(event) => update(index, { kcal: event.target.value })} />
                        <span className="shrink-0 text-caption font-semibold text-ink-faint">kcal</span>
                      </span>
                    </Td>
                    <Td>
                      {row.isDefault ? (
                        <Chip tone="ok">既定</Chip>
                      ) : (
                        <button type="button" className="text-label font-semibold text-accent-deep" onClick={() => setDefault(index)}>既定にする</button>
                      )}
                    </Td>
                    <Td align="right">
                      <DeleteAction label={`${row.name || 'この主食'}を削除する`} onClick={() => remove(index)} />
                    </Td>
                  </Tr>
                ))}
                <Tr>
                  <Td colSpan={4}>
                    <button type="button" className="text-label font-semibold text-accent-deep" onClick={add} disabled={drafts.length >= MAX_PRODUCTS}>
                      ＋ 主食を追加
                    </button>
                  </Td>
                </Tr>
              </tbody>
            </DataTable>
          )}
        </section>

        <div data-design="Side" data-design-node="feeding-side" className="flex flex-col gap-4">
          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
            <h2 className="text-body font-bold text-ink">計算のしかた</h2>
            <p className="mt-2 text-caption text-ink-secondary">公的な指針（NRC／FEDIAF）の式をそのまま使います。</p>
            <dl className="mt-3 flex flex-col gap-2">
              <FormulaRow label="安静時エネルギー" value="70 × 体重(kg) の 0.75 乗" />
              <FormulaRow label="1日の必要カロリー" value="安静時エネルギー × 係数" />
              <FormulaRow label="1日の目安（g）" value="必要カロリー ÷ 主食の kcal/100g × 100" />
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
            <p className="mt-1 text-micro text-ink-faint">主食を保存すると、この全員の目安が計算し直されます。</p>
          </section>
        </div>
      </div>

      <StickyBar
        status={dirty ? '保存していない変更があります' : undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={cancel} disabled={busy || !dirty}>キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty}>保存する</Button>
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
