'use client'

/*
 * ★V8 デリバリー受注・品切れ一括設定（板 `h7OeT`）と受付の一括停止（窓 `XCVGd`）。
 *
 * 品切れ一括設定は絵のとおり「板」（窓ではない）。上の帯の段は
 * `飲食店向け（テスト） › デリバリー受注 › 品切れ一括設定` になる。
 * 探す欄と「品切れ中のみ」は板の頭（親が RestaurantPage の picker に置く）。
 *
 * どちらも送信は親（delivery.tsx）が持ち、ここは選んでもらうだけにする。
 * 受付の停止は取り消せないので、対象と戻し方を文字で必ず見せる。
 * サービスから返った文はそのまま出さない（日本語の案内と品名だけを出す）。
 */

import { Ban, Pause, RotateCcw } from 'lucide-react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, TableStateRow, Td, Th, Tr } from '@/components/shared/table'
import Toggle from '@/components/shared/toggle'
import {
  DELIVERY_SERVICE_LABELS,
  type DeliveryIntakeStopPreset,
  type DeliveryMenuItem,
  type DeliveryService,
  type DeliveryServiceState,
} from '@/lib/restaurant-delivery-api'
import { DialogField, DialogNote, RsDialog } from '../booking-kit/parts'
import { DASH, INTAKE_STOP_PRESET_OPTIONS, SERVICE_TONES, formatYen } from './format'
import styles from './delivery.module.css'

/*
 * 受付停止の確認（XCVGd）。上からの位置は絵のとおり 230。
 * 幅は絵が 500 だが、窓の幅は正本で 480／560／720／960 の4段に決まっている
 * （docs/v8-design-rules.md §8・B-177 の `DIALOG_WIDTHS`）。500 は4段に無いので
 * 共通部品の `dialogWidth()` が 480 へ寄せる。暗に寄せられるのに任せず、
 * 実際に出る 480 をここに書く。中身は真ん中に並ぶので絵より左右 10 外へ出る
 * （この差は「絵と正本の食い違いを正本で解いた分」として記録する）。
 */
const STOP_WIDTH = 480
const STOP_TOP = 230
/*
 * 絵（XCVGd）の段の間。絵は段ごとに下の余白を持ち、一文の下が 10・欄の下が 12。
 * 段の間は1つの値しか持てないので小さい方の 10 に合わせる（下の欄が 2 上がるが
 * ±4 の内）。欄の題と中身の間は 8（絵 `nYJz5`・時間選択の `gap: 8px`）で、
 * これは共通の欄の `contentGap` で渡す。窓の引数では共通の欄まで届かない。
 * ボタンの段の上の間は 14（絵の y598→612）。
 */
const STOP_BODY_GAP = 10
const STOP_FIELD_GAP = 8
const STOP_FOOT_GAP = 14

const SOLD_OUT_COLUMN_COUNT = 6
/** 閲覧のみの人には「選択」と「切替」を出さないので2つ少ない（★V8 2026-10-06）。 */
const SOLD_OUT_COLUMN_COUNT_VIEW_ONLY = SOLD_OUT_COLUMN_COUNT - 2

/* ── D-5 `h7OeT` 品切れ一括設定 ───────────────────────────────── */

export interface SoldOutHeaderActionsProps {
  query: string
  soldOutOnly: boolean
  /** 品切れ中の品数。取れていないときは出さない。 */
  soldOutCount: number | undefined
  disabled?: boolean
  onQueryChange: (value: string) => void
  onSoldOutOnlyChange: (value: boolean) => void
}

/** 板の頭の右（探す欄と「品切れ中のみ」）。親が RestaurantPage の picker へ置く。 */
export function SoldOutHeaderActions({
  query,
  soldOutOnly,
  soldOutCount,
  disabled = false,
  onQueryChange,
  onSoldOutOnlyChange,
}: SoldOutHeaderActionsProps) {
  return (
    <div className={styles.filterRow}>
      <SearchField
        aria-label="商品名で探す"
        placeholder="商品名で探す"
        value={query}
        disabled={disabled}
        onChange={onQueryChange}
        onClear={() => onQueryChange('')}
      />
      <FilterChip
        selected={soldOutOnly}
        disabled={disabled}
        count={soldOutCount}
        onChange={onSoldOutOnlyChange}
      >
        品切れ中のみ
      </FilterChip>
    </div>
  )
}

export interface SoldOutBoardProps {
  loading: boolean
  /** 日本語の案内だけを入れる。 */
  error: string | null
  /** 探す欄と「品切れ中のみ」で絞ったあとの品。 */
  items: DeliveryMenuItem[]
  /** 絞る前の総数（足もとの「全N品中」）。 */
  total: number
  /** 選んだ品の id。 */
  selected: string[]
  shown: number
  /** まとめて送っている間。 */
  busy: boolean
  /** 1品だけ切り替えている間の id。 */
  busyItemId: string | null
  canManage: boolean
  onToggle: (id: string, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  /** 行の切替。`soldOut` が送りたい次の状態。 */
  onToggleOne: (id: string, soldOut: boolean) => void
  /** `true` で品切れ・`false` で販売再開。 */
  onSubmit: (soldOut: boolean) => void
  onRetry: () => void
  onShowMore: () => void
}

/** D-5 `h7OeT`。品切れにした品は3つのサービスすべてで注文できなくなる。 */
export default function SoldOutBoard({
  loading,
  error,
  items,
  total,
  selected,
  shown,
  busy,
  busyItemId,
  canManage,
  onToggle,
  onToggleAll,
  onToggleOne,
  onSubmit,
  onRetry,
  onShowMore,
}: SoldOutBoardProps) {
  const visible = items.slice(0, shown)
  const selectedSet = new Set(selected)
  const checkedCount = visible.filter((item) => selectedSet.has(item.id)).length
  const allChecked = visible.length > 0 && checkedCount === visible.length
  const someChecked = checkedCount > 0 && !allChecked
  // 権限の有無は帯ごと出す・出さないで分ける。ここは「選んでいないので押せない」だけ。
  const canSubmit = checkedCount > 0 && !busy

  return (
    <>
      {loading && items.length === 0 && !error ? (
        <div className={styles.stateBox}>
          <ListState kind="loading" title="メニューを読み込んでいます" />
        </div>
      ) : null}
      {error && items.length === 0 ? (
        <ListState
          kind="error"
          title="メニューを表示できませんでした"
          description={error}
          onRetry={onRetry}
        />
      ) : null}

      {items.length > 0 ? (
        <>
          {/* 閲覧のみの人は選べないので、選んだ数の帯もまとめての札も出さない（★V8 2026-10-06）。 */}
          {canManage ? (
          <div className={styles.selectBar}>
            <span className={styles.selectCount}>選択中 {checkedCount}品</span>
            <span className={styles.spacer} />
            <Button
              variant="danger-outline"
              size="delivery-bulk"
              widthReserve="idle"
              disabled={!canSubmit}
              busy={busy}
              busyLabel="送信中…"
              onClick={() => onSubmit(true)}
            >
              <Ban size={13} aria-hidden="true" />選んだ商品を品切れにする
            </Button>
            <Button
              variant="secondary"
              size="delivery-bulk"
              widthReserve="idle"
              disabled={!canSubmit}
              onClick={() => onSubmit(false)}
            >
              <RotateCcw size={13} aria-hidden="true" />販売を再開する
            </Button>
          </div>
          ) : null}

          {error ? <p className={styles.muted}>{error}</p> : null}

          <DataTable className={styles.table} data-design="h7OeT" presentation="delivery" label="メニューの品切れ設定"><thead>
            <TableHeadRow>
              {canManage ? (
                <Th className={styles.th}>
                  <Checkbox
                    aria-label="表示中をすべて選ぶ"
                    checked={allChecked}
                    indeterminate={someChecked}
                    onCheckedChange={onToggleAll}
                  />
                </Th>
              ) : null}
              <Th className={styles.th}>商品名</Th>
              <Th className={styles.th}>分類</Th>
              {/*
                * 絵（h7OeT）の「価格」は左。見出し `X4NEtR` も中の欄 `hwhgs`・`IRs4m` も
                * 左寄せで、右へ寄せる詰め物を持っていない。注文履歴（OzHLO）の「金額」は
                * 逆に詰め物を持っていて右寄せなので、3つの表をまとめて同じにしない。
                */}
              <Th className={styles.th}>価格</Th>
              <Th className={styles.th}>状態</Th>
              {canManage ? <Th className={styles.th}>切替</Th> : null}
            </TableHeadRow></thead><tbody>
            {visible.length === 0 ? (
              <TableStateRow
                colSpan={canManage ? SOLD_OUT_COLUMN_COUNT : SOLD_OUT_COLUMN_COUNT_VIEW_ONLY}
                kind="empty"
              />
            ) : (
              visible.map((item) => (
                <Tr key={item.id}>
                  {canManage ? (
                    <Td>
                      <Checkbox
                        aria-label={`${item.name || '商品'}を選ぶ`}
                        checked={selectedSet.has(item.id)}
                        onCheckedChange={(checked) => onToggle(item.id, checked)}
                      />
                    </Td>
                  ) : null}
                  <Td>
                    <span className={styles.menuName} title={item.name || undefined}>
                      {item.name || DASH}
                    </span>
                  </Td>
                  <Td>{item.category || DASH}</Td>
                  <Td>
                    <span className={styles.amount}>{formatYen(item.price)}</span>
                  </Td>
                  <Td>
                    <StatusBadge tone={item.soldOut ? 'warning' : 'success'} size="delivery">
                      {item.soldOut ? '品切れ' : '販売中'}
                    </StatusBadge>
                  </Td>
                  {canManage ? (
                    <Td>
                      <Toggle
                        label={`${item.name || '商品'}の販売`}
                        checked={!item.soldOut}
                        disabled={busy || busyItemId === item.id}
                        onChange={(next) => onToggleOne(item.id, !next)}
                      />
                    </Td>
                  ) : null}
                </Tr>
              ))
            )}
          </tbody></DataTable>

          <div className={styles.tableFoot}>
            <p className={styles.muted}>
              全{total}品中 1〜{visible.length}品を表示
            </p>
            {visible.length < items.length ? (
              <Button variant="text" size="compact" onClick={onShowMore}>さらに表示</Button>
            ) : null}
          </div>
        </>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <ListState kind="empty" title="あてはまる商品がありません" />
      ) : null}
    </>
  )
}

/* ── D-6 `XCVGd` 受付の一括停止 ───────────────────────────────── */

export interface IntakeStopDialogProps {
  open: boolean
  /** サービスの今の状態。すでに停止中のものは「対象外」にする。 */
  services: DeliveryServiceState[]
  /** 止める相手として選んでいるもの。 */
  selected: DeliveryService[]
  preset: DeliveryIntakeStopPreset
  busy: boolean
  /** 日本語の案内だけを入れる。 */
  error: string | null
  onToggleService: (service: DeliveryService, checked: boolean) => void
  onPresetChange: (preset: DeliveryIntakeStopPreset) => void
  onClose: () => void
  onSubmit: () => void
}

/** D-6 `XCVGd`。受付を止めると新しい注文が来なくなるので、対象と時間を見せてから送る。 */
export function IntakeStopDialog({
  open,
  services,
  selected,
  preset,
  busy,
  error,
  onToggleService,
  onPresetChange,
  onClose,
  onSubmit,
}: IntakeStopDialogProps) {
  const selectedSet = new Set(selected)
  const stoppable = services.filter((state) => state.intakeStatus === 'open')
  const canSubmit = !busy && stoppable.some((state) => selectedSet.has(state.service))

  return (
    <RsDialog
      open={open}
      title="受付を一括停止しますか？"
      width={STOP_WIDTH}
      top={STOP_TOP}
      tone="destructive"
      busy={busy}
      designNode="XCVGd"
      /* 絵（`lSfGT`）の頭は白地。帯で囲まず、題の左の丸い印の中は一時停止の印。 */
      titleIcon={(
        <span className={styles.warnMark}>
          <Pause size={18} aria-hidden="true" />
        </span>
      )}
      titleRow="mark"
      plainTitle
      contentPadding="18px 24px 20px"
      bodyGap={STOP_BODY_GAP}
      footerPlain
      footerGap={STOP_FOOT_GAP}
      onCancel={onClose}
      actions={(
        <>
          <Button onClick={onClose} disabled={busy}>← 戻る</Button>
          <Button
            variant="danger"
            busy={busy}
            busyLabel="停止中…"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            <Pause size={15} aria-hidden="true" />受付を停止する
          </Button>
        </>
      )}
    >
      <p className={styles.dialogLead}>
        選んだサービスで新しい注文の受け付けを止めます。すでに受け付けた注文の調理・受け渡しはそのまま続きます。
      </p>

      <DialogField label="停止するサービス" kind="select" contentGap={STOP_FIELD_GAP}>
        <div className={styles.stopList}>
          {services.length === 0 ? (
            <p className={styles.muted}>{DASH}</p>
          ) : (
            services.map((state) => {
              const label = state.label || DELIVERY_SERVICE_LABELS[state.service]
              const stopped = state.intakeStatus === 'stopped'
              const picked = !stopped && selectedSet.has(state.service)
              return (
                <div
                  key={state.service}
                  className={`${styles.stopCard} ${picked ? styles.stopCardOn : ''} ${stopped ? styles.stopCardOff : ''}`}
                >
                  {/* サービス名は色の付いた札で見せるので、印には読み上げ名を渡す。 */}
                  <Checkbox
                    aria-label={`${label}の受付を停止する`}
                    checked={picked}
                    disabled={stopped || busy}
                    onCheckedChange={(checked) => onToggleService(state.service, checked)}
                  />
                  {/* 絵（XCVGd `Iv4Dr`/`Cxo9i`/`XK0ja`）のサービス札は点なしの丸い札。 */}
                  <StatusBadge tone={SERVICE_TONES[state.service]} size="compact" dot={false}>{label}</StatusBadge>
                  <span className={`${styles.stopState} ${stopped ? styles.stopStateOff : ''}`}>
                    {stopped ? 'すでに停止中' : `現在 受付中・${state.todayCount}件対応中`}
                  </span>
                  {/* 絵（XCVGd）の札には細い横線が無いので、線は置かず右へ寄せるだけにする。 */}
                  <span className={`${styles.stopMark} ${stopped ? styles.stopMarkOff : ''}`}>
                    {stopped ? '対象外' : '停止する'}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </DialogField>

      {/* 絵（`To5Y0`）の時間はつながった帯ではなく離れた札4つ。押した札だけ薄い緑にする。 */}
      <DialogField label="停止する時間（過ぎると自動で再開します）" kind="select" contentGap={STOP_FIELD_GAP}>
        <div className={styles.timeRow} role="group" aria-label="停止する時間">
          {INTAKE_STOP_PRESET_OPTIONS.map((option) => {
            const value = option.value as DeliveryIntakeStopPreset
            const on = preset === value
            return (
              <button
                key={value}
                type="button"
                className={`${styles.timeCard} ${on ? styles.timeCardOn : ''}`}
                aria-pressed={on}
                disabled={busy}
                onClick={() => onPresetChange(value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </DialogField>

      {error ? <DialogNote>{error}</DialogNote> : null}
    </RsDialog>
  )
}
