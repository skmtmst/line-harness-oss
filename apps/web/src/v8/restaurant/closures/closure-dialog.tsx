'use client'

/*
 * ★V8 臨時休業・貸切を足す／変える窓（提案 E-10 `nVvXy`）。
 *
 * 種類 → はじめの日〜おわりの日 → 時間（終日／時間帯だけ）→ 閉じる卓（全部／選ぶ）→ メモ
 * → 重なる予約（保存しても取り消さない・1件ずつ「LINE で連絡する」）→ 他の予約サイトと Google。
 * 入力が変わるたびに少し待って preview を呼び、重なる予約を出す。保存は予約を取り消さず、お客さまへ送信もしない。
 * 動きは BEHAVIOR.md。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Phone } from 'lucide-react'
import type { RestaurantClosure, RestaurantClosureInput, RestaurantClosureKind, RestaurantClosurePreview } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import DateField from '@/components/shared/date-field'
import Dialog from '@/components/shared/dialog'
import Radio from '@/components/shared/radio'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { ApiError } from '@/lib/api'
import { restaurantGoogleApi } from '@/lib/restaurant-google-api'
import { restaurantTestApi, type RestaurantReservation, type RestaurantTable } from '@/lib/restaurant-test-api'
import {
  KIND_LABEL, KIND_ORDER, clock, dayOfIso, dayShort, emptyInput, inputError, inputOf, overlapping, sourceLabel, timeOptions,
} from './format'
import styles from './closures.module.css'

export type ClosureDialogTarget = { mode: 'add'; day: string } | { mode: 'edit'; closure: RestaurantClosure }

type Row = { id: string; startsAt: string; guestCount: number; customerName: string; source: string; friendId: string | null; phone: string | null }

export type ClosureSaved = { closure: RestaurantClosure; reservations: number; google: 'made' | 'failed' | 'skipped' }

function rowsFromPreview(preview: RestaurantClosurePreview, known: RestaurantReservation[]): Row[] {
  return preview.reservations.map((r) => ({
    id: r.id, startsAt: r.startsAt, guestCount: r.guestCount, customerName: r.customerName, source: r.source,
    friendId: r.isLineFriend ? r.friendId : null,
    phone: known.find((k) => k.id === r.id)?.customer_phone ?? null,
  }))
}

function rowsFromLedger(rows: RestaurantReservation[]): Row[] {
  return rows.map((r) => ({ id: r.id, startsAt: r.starts_at, guestCount: r.guest_count, customerName: r.customer_name, source: r.source, friendId: null, phone: r.customer_phone }))
}

function saveMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'closure_overlap') return '同じ日・同じ卓に、ほかの休業・貸切があります。日付か卓を変えてください。'
    if (error.code === 'version_conflict') return 'ほかの人が先に変えました。閉じて、読み直してからもう一度変えてください。'
    if (error.status === 403) return 'この店舗の予約枠を変える権限がありません。'
  }
  return error instanceof Error && error.message ? error.message : '保存できませんでした。もう一度お試しください。'
}

export default function ClosureDialog({
  target, accountId, storeId, timezone, today, tables, reservations, media, canGoogle, onClose, onSaved,
}: {
  /** null のとき閉じている。 */
  target: ClosureDialogTarget | null
  accountId: string
  storeId: string
  timezone: string
  today: string
  tables: RestaurantTable[]
  /** 画面が読んだ予約（電話番号を出す・変える窓で重なる予約を数える）。 */
  reservations: RestaurantReservation[]
  /** 閉じる知らせを出す媒体（店が「予約が入ったら閉じる」を選んだ媒体）。 */
  media: Array<{ code: string; name: string }>
  /** Google の営業時間の案を作れる人（owner・admin）か。 */
  canGoogle: boolean
  onClose: () => void
  onSaved: (result: ClosureSaved) => void
}) {
  const open = target !== null
  const editing = target?.mode === 'edit' ? target.closure : null
  const [input, setInput] = useState<RestaurantClosureInput>(() => emptyInput(storeId, today))
  const [pickTables, setPickTables] = useState(false)
  const [google, setGoogle] = useState(true)
  const [preview, setPreview] = useState<{ rows: Row[]; waitlist: number; overlap: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  const active = useMemo(() => tables.filter((t) => t.is_active), [tables])
  const seats = active.reduce((sum, t) => sum + t.max_capacity, 0)

  /* 開くたびに入力を作り直す（足す＝押した日、変える＝その記録）。 */
  useEffect(() => {
    if (!target) return
    const next = target.mode === 'edit' ? inputOf(target.closure) : emptyInput(storeId, target.day)
    setInput(next)
    setPickTables(next.tableIds !== undefined && next.tableIds.length > 0)
    setGoogle(target.mode === 'add')
    setPreview(null)
    setError('')
  }, [target, storeId])

  const problem = inputError(input, today)
  const partial = (input.tableIds ?? []).length > 0

  /*
   * 重なる予約。足す窓は preview の口（LINE の友だちかどうかも返る）。
   * 変える窓は、口が自分自身と重なって 409 になるので、画面が読んだ予約から数える。
   */
  useEffect(() => {
    if (!open || problem || !accountId) { setPreview(null); return }
    const id = ++seq.current
    const timer = setTimeout(() => {
      if (editing) {
        const rows = overlapping(input, reservations, timezone)
        setPreview({ rows: rowsFromLedger(rows), waitlist: 0, overlap: false })
        return
      }
      void restaurantTestApi.previewClosure(accountId, input)
        .then((res) => { if (id === seq.current) setPreview({ rows: rowsFromPreview(res.data, reservations), waitlist: res.data.waitlistCount, overlap: false }) })
        .catch((caught) => {
          if (id !== seq.current) return
          if (caught instanceof ApiError && caught.code === 'closure_overlap') {
            setPreview({ rows: rowsFromLedger(overlapping(input, reservations, timezone)), waitlist: 0, overlap: true })
          } else {
            setPreview({ rows: rowsFromLedger(overlapping(input, reservations, timezone)), waitlist: 0, overlap: false })
          }
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [open, problem, accountId, input, editing, reservations, timezone])

  const set = (patch: Partial<RestaurantClosureInput>) => { setInput((current) => ({ ...current, ...patch })); setError('') }

  const save = async () => {
    if (problem) { setError(problem); return }
    if (pickTables && !partial) { setError('閉じる卓を1つ以上選んでください。'); return }
    setBusy(true); setError('')
    try {
      const body: RestaurantClosureInput = { ...input, tableIds: pickTables ? input.tableIds : [], memo: input.memo?.trim() || null }
      const res = editing
        ? await restaurantTestApi.updateClosure(accountId, editing.id, { ...body, expectedVersion: editing.version })
        : await restaurantTestApi.createClosure(accountId, body)
      const saved = res.data.closure
      let googleResult: ClosureSaved['google'] = 'skipped'
      if (google && canGoogle && !partial && !editing) {
        try {
          await restaurantGoogleApi.proposeClosureHours(accountId, saved.id, saved.version, saved.kind === 'private_event')
          googleResult = 'made'
        } catch {
          googleResult = 'failed'
        }
      }
      onSaved({ closure: saved, reservations: res.data.reservations.length, google: googleResult })
    } catch (caught) {
      setError(saveMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const days = input.startDate === input.endDate ? 'この日' : 'この期間'
  const rows = preview?.rows ?? []
  const mediaNames = media.map((m) => m.name).join('・')

  return (
    <Dialog
      open={open}
      designNode="nVvXy"
      designWidth={600}
      designTop={147}
      designHeaderPadding="20px 24px 0"
      footerAlign="center"
      title={editing ? '臨時休業・貸切を変える' : '臨時休業・貸切を足す'}
      description="閉じた日・時間帯は LINE から予約できなくなります"
      busy={busy}
      error={error || undefined}
      confirmLabel={editing ? '変更を保存' : days === 'この日' ? 'この日を閉じる' : 'この期間を閉じる'}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <span className={styles.label} id="e10-kind">種類</span>
          <SegmentedControl<RestaurantClosureKind>
            aria-label="種類"
            className={styles.kinds}
            options={KIND_ORDER.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))}
            value={input.kind}
            onChange={(kind) => { set({ kind }); if (!editing) setGoogle(kind !== 'private_event') }}
          />
        </div>

        <div className={styles.dates}>
          <label className={styles.field}>
            <span className={styles.label}>はじめの日</span>
            <DateField
              value={input.startDate}
              min={today}
              onChange={(value) => set({ startDate: value, endDate: input.endDate < value ? value : input.endDate })}
            />
          </label>
          <span className={styles.wave} aria-hidden="true">〜</span>
          <label className={styles.field}>
            <span className={styles.label}>おわりの日</span>
            <DateField value={input.endDate} min={input.startDate || today} onChange={(value) => set({ endDate: value })} />
          </label>
        </div>

        <div className={styles.field} role="radiogroup" aria-labelledby="e10-time">
          <span className={styles.label} id="e10-time">時間</span>
          <div className={styles.choices}>
            <Radio name="e10-time" checked={input.allDay} onChange={() => set({ allDay: true, startTime: null, endTime: null })}>終日</Radio>
            <Radio name="e10-time" checked={!input.allDay} onChange={() => set({ allDay: false, startTime: input.startTime ?? '18:00', endTime: input.endTime ?? '22:00' })}>
              時間帯だけ（例：18:00〜22:00）
            </Radio>
          </div>
          {!input.allDay ? (
            <div className={styles.times}>
              <Select aria-label="閉じる時間の始まり" width={120} value={input.startTime ?? ''} onChange={(value) => set({ startTime: value })} options={timeOptions().map((t) => ({ value: t, label: t }))} />
              <span className={styles.wave} aria-hidden="true">〜</span>
              <Select aria-label="閉じる時間の終わり" width={120} value={input.endTime ?? ''} onChange={(value) => set({ endTime: value })} options={timeOptions(true).slice(1).map((t) => ({ value: t, label: t }))} />
            </div>
          ) : null}
        </div>

        <div className={styles.field} role="radiogroup" aria-labelledby="e10-tables">
          <span className={styles.label} id="e10-tables">閉じる卓</span>
          <div className={styles.choices}>
            <Radio name="e10-tables" checked={!pickTables} onChange={() => { setPickTables(false); set({ tableIds: [] }) }}>
              {`全部の卓（${active.length}卓・${seats}席）`}
            </Radio>
            <Radio name="e10-tables" checked={pickTables} onChange={() => setPickTables(true)}>卓を選ぶ（貸切の一部など）</Radio>
          </div>
          {pickTables ? (
            <div className={styles.tablePicks}>
              {active.map((t) => (
                <Checkbox
                  key={t.id}
                  checked={(input.tableIds ?? []).includes(t.id)}
                  onCheckedChange={(on) => set({ tableIds: on ? [...(input.tableIds ?? []), t.id] : (input.tableIds ?? []).filter((id) => id !== t.id) })}
                >
                  {`${t.code}（${t.max_capacity}席）`}
                </Checkbox>
              ))}
            </div>
          ) : null}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>メモ<span className={styles.optional}>任意</span></span>
          <TextField value={input.memo ?? ''} maxLength={200} placeholder="例：設備点検のため" onChange={(event) => set({ memo: event.target.value })} />
        </label>

        {problem ? null : preview === null ? (
          <p className={styles.hint} aria-live="polite">{`${days}の予約を調べています。`}</p>
        ) : (
          <>
            {preview.overlap ? (
              <p className={styles.overlap} role="alert">同じ日・同じ卓に、ほかの休業・貸切があります。日付か卓を変えてください。</p>
            ) : null}
            {rows.length > 0 ? (
              <div className={styles.affected} data-affected="">
                <p className={styles.affectedTitle}>
                  <AlertTriangle size={16} aria-hidden="true" />
                  {`${days}の予約が ${rows.length}件あります（保存しても取り消しません）`}
                </p>
                {rows.map((row) => (
                  <div key={row.id} className={styles.affectedRow}>
                    <span className={styles.affectedTime}>{input.startDate === input.endDate ? clock(row.startsAt, timezone) : `${dayShort(dayOfIso(row.startsAt, timezone))} ${clock(row.startsAt, timezone)}`}</span>
                    <span className={styles.affectedName} title={row.customerName}>{`${row.customerName} さま・${row.guestCount}名`}</span>
                    <span className={styles.route}>{sourceLabel(row.source, media)}</span>
                    {row.friendId ? (
                      <Button href={`/chats?friend=${encodeURIComponent(row.friendId)}`}>LINE で連絡する</Button>
                    ) : (
                      <Button variant="text" href={`/restaurant-test/reservations?date=${dayOfIso(row.startsAt, timezone)}`}>
                        <Phone size={15} aria-hidden="true" />{row.phone ? `電話で連絡（${row.phone}）` : '電話で連絡（番号は予約台帳）'}
                      </Button>
                    )}
                  </div>
                ))}
                {preview.waitlist > 0 ? <p className={styles.hint}>{`キャンセル待ちの ${preview.waitlist}件には、閉じた時間帯の空きを案内しません。`}</p> : null}
              </div>
            ) : (
              <p className={styles.hint}>{`${days}の予約はありません。`}</p>
            )}
          </>
        )}

        <div className={styles.field}>
          <span className={styles.label}>他の予約サイトと Google</span>
          <div className={styles.checks}>
            {media.length > 0 ? (
              <Checkbox checked onCheckedChange={() => {}} disabled title="閉じた日は、店が選んだ媒体へ必ず知らせを出します">
                {`${mediaNames}に「閉じる知らせ」を出す（媒体ごとに［閉じた］を押す）`}
              </Checkbox>
            ) : (
              <p className={styles.hint}>閉じる知らせを出す予約サイトはありません（予約経路の連携で選べます）。</p>
            )}
            {canGoogle && !editing ? (
              <Checkbox
                checked={google && !partial}
                disabled={partial}
                onCheckedChange={setGoogle}
                description={partial ? '卓を選んだ貸切は、Google では店全体の休みになるので案を作りません。' : undefined}
              >
                Google の営業時間にも臨時休業を入れる案を作る
              </Checkbox>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
