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
import SegmentedControl from '@/components/shared/segmented'
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
import { DASH, INTAKE_STOP_PRESET_OPTIONS, formatYen } from './format'
import styles from './delivery.module.css'

/** 窓の寸法（絵のとおり）。確認の窓は小さめ。 */
const STOP_WIDTH = 480
const STOP_TOP = 260

const SOLD_OUT_COLUMN_COUNT = 6

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
  const canSubmit = canManage && checkedCount > 0 && !busy

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
          <div className={styles.selectBar}>
            <span className={styles.selectCount}>選択中 {checkedCount}品</span>
            <span className={styles.spacer} />
            <Button
              variant="danger-outline"
              size="compact"
              disabled={!canSubmit}
              busy={busy}
              busyLabel="送信中…"
              onClick={() => onSubmit(true)}
            >
              <Ban size={15} aria-hidden="true" />選んだ商品を品切れにする
            </Button>
            <Button
              variant="secondary"
              size="compact"
              disabled={!canSubmit}
              onClick={() => onSubmit(false)}
            >
              <RotateCcw size={15} aria-hidden="true" />販売を再開する
            </Button>
          </div>

          {error ? <p className={styles.muted}>{error}</p> : null}

          <DataTable className={styles.table} data-design="h7OeT" label="メニューの品切れ設定"><thead>
            <TableHeadRow>
              <Th className={styles.th}>
                <Checkbox
                  aria-label="表示中をすべて選ぶ"
                  checked={allChecked}
                  indeterminate={someChecked}
                  disabled={!canManage}
                  onCheckedChange={onToggleAll}
                />
              </Th>
              <Th className={styles.th}>商品名</Th>
              <Th className={styles.th}>分類</Th>
              <Th className={styles.th} align="right">価格</Th>
              <Th className={styles.th}>状態</Th>
              <Th className={styles.th}>切替</Th>
            </TableHeadRow></thead><tbody>
            {visible.length === 0 ? (
              <TableStateRow colSpan={SOLD_OUT_COLUMN_COUNT} kind="empty" />
            ) : (
              visible.map((item) => (
                <Tr key={item.id}>
                  <Td className={styles.td}>
                    <Checkbox
                      aria-label={`${item.name || '商品'}を選ぶ`}
                      checked={selectedSet.has(item.id)}
                      disabled={!canManage}
                      onCheckedChange={(checked) => onToggle(item.id, checked)}
                    />
                  </Td>
                  <Td className={styles.td}>
                    <span className={styles.checkMain}>{item.name || DASH}</span>
                  </Td>
                  <Td className={styles.td}>{item.category || DASH}</Td>
                  <Td className={styles.td} align="right">
                    <span className={styles.amount}>{formatYen(item.price)}</span>
                  </Td>
                  <Td className={styles.td}>
                    <StatusBadge tone={item.soldOut ? 'warning' : 'success'} size="compact">
                      {item.soldOut ? '品切れ' : '販売中'}
                    </StatusBadge>
                  </Td>
                  <Td className={styles.td}>
                    <Toggle
                      label={`${item.name || '商品'}の販売`}
                      checked={!item.soldOut}
                      disabled={!canManage || busy || busyItemId === item.id}
                      onChange={(next) => onToggleOne(item.id, !next)}
                    />
                  </Td>
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
      <p className={styles.factValue}>
        選んだサービスで新しい注文の受け付けを止めます。すでに受け付けた注文の調理・受け渡しはそのまま続きます。
      </p>

      <DialogField label="停止するサービス">
        <div className={styles.checkList}>
          {services.length === 0 ? (
            <p className={styles.muted}>{DASH}</p>
          ) : (
            services.map((state) => {
              const label = state.label || DELIVERY_SERVICE_LABELS[state.service]
              const stopped = state.intakeStatus === 'stopped'
              return (
                <div key={state.service} className={styles.checkRow}>
                  <Checkbox
                    className={styles.checkMain}
                    checked={!stopped && selectedSet.has(state.service)}
                    disabled={stopped || busy}
                    description={stopped ? 'すでに停止中' : `現在 受付中・${state.todayCount}件対応中`}
                    onCheckedChange={(checked) => onToggleService(state.service, checked)}
                  >
                    {label}
                  </Checkbox>
                  <span className={styles.checkState}>{stopped ? '対象外' : '停止する'}</span>
                </div>
              )
            })
          )}
        </div>
      </DialogField>

      <DialogField label="停止する時間（過ぎると自動で再開します）" kind="select">
        <SegmentedControl
          aria-label="停止する時間"
          equalWidth
          disabled={busy}
          value={preset}
          onChange={(value) => onPresetChange(value as DeliveryIntakeStopPreset)}
          options={INTAKE_STOP_PRESET_OPTIONS.map((option) => ({
            value: option.value as DeliveryIntakeStopPreset,
            label: option.label,
          }))}
        />
      </DialogField>

      <DialogNote>
        停止するとお客様の画面から受付が閉じ、新しい注文は届きません。時間が過ぎると自動で戻り、札の「再開」でいつでも戻せます。
      </DialogNote>
      {error ? <DialogNote>{error}</DialogNote> : null}
    </RsDialog>
  )
}
