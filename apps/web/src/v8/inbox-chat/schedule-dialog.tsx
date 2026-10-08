'use client'

/*
 * ★V8「予約して送る」（M0393 段2「6. 予約して送る（書く欄から・テンプレートと画像も）」）。
 *
 * 前は書く欄の上に「送る日時 ［日時を選ぶ］［この日時で予約する］」の段が出ていた
 * （オーナー指摘：嫌）。書く欄の下の［予約］から窓で開く。送るもの・すぐ選ぶ・
 * 日時を決める・夜中の注意・予約済みの一覧（時刻を直す・取り消す）を1つの窓に置く。
 * 予約そのものの動き（口・二度押し止め・日本時間）は画面側の今の処理をそのまま呼ぶ。
 */
import { Clock3, FileText } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import DateTimeField from '@/components/shared/date-time-field'
import FilterChip from '@/components/shared/filter-chip'
import { isNightJst, schedulePresets, shortJst } from './schedule-presets'
import styles from './inbox-chat.module.css'

export type ScheduledRowView = {
  id: string
  /** 送る日時（日本時間で読める形） */
  label: string
  content: string
  /** 予約中だけ直せる・取り消せる（送信中・送信済みは不可） */
  editable: boolean
  /** 時刻を直す欄の初期値（日本時間の datetime-local） */
  defaultValue: string
}

export default function ScheduleSendDialog({
  open,
  onClose,
  content,
  hasImage,
  attachmentLabel,
  value,
  onChange,
  onConfirm,
  busy,
  error,
  rows,
  rowsFailed,
  onRetryRows,
  onReschedule,
  onCancelRow,
  now,
}: {
  open: boolean
  onClose: () => void
  /** 書く欄の本文（送るもの） */
  content: string
  hasImage: boolean
  /** B-6：準備済みの動画・ファイル（例：動画「説明.mp4」）。無いときは出さない。 */
  attachmentLabel?: string
  /** 日本時間の datetime-local */
  value: string
  onChange: (next: string) => void
  onConfirm: () => void
  busy: boolean
  error?: string
  rows: ScheduledRowView[]
  rowsFailed: boolean
  onRetryRows: () => void
  onReschedule: (id: string, next: string) => void
  onCancelRow: (id: string) => void
  /** 試験で「いま」を固定する */
  now?: Date
}) {
  const presets = schedulePresets(now)
  const firstLine = content.trim().split('\n')[0] ?? ''
  const summary = [firstLine ? `「${firstLine}」` : '', hasImage ? '画像 1枚' : '', attachmentLabel ?? ''].filter(Boolean).join(' ＋ ')
  const night = value ? isNightJst(value) : false

  return (
    <Dialog
      open={open}
      onCancel={onClose}
      title="予約して送る"
      designWidth={420}
      busy={busy}
      error={error}
      confirmLabel={value ? `${shortJst(value)} に予約` : 'この日時で予約する'}
      confirmIcon={<Clock3 aria-hidden="true" />}
      onConfirm={onConfirm}
    >
      <div className={styles.schBox}>
        <p className={styles.schBoxLabel}>送るもの</p>
        <p className={styles.schBoxValue}>
          <FileText aria-hidden="true" className={styles.schBoxIcon} />
          <span className={styles.schBoxText} title={content}>{summary || '書く欄に文を入れてください'}</span>
        </p>
      </div>
      <div className={styles.schGroup}>
        <p className={styles.schLabel}>すぐ選ぶ</p>
        <div className={styles.schChips}>
          {presets.map((preset) => (
            <FilterChip
              key={preset.key}
              selected={value === preset.value}
              onChange={() => onChange(preset.value)}
            >
              {preset.label}
            </FilterChip>
          ))}
        </div>
      </div>
      <div className={styles.schGroup}>
        <label htmlFor="schedule-at" className={styles.schLabel}>日時を決める</label>
        <DateTimeField id="schedule-at" value={value} onChange={onChange} className={styles.schField} />
        <p className={styles.schNote}>日本時間です。相手が夜中（22時〜8時）になる日時は、選ぶと注意が出ます。</p>
        {night ? (
          <p className={styles.schWarn} role="status">相手が夜中の時間です。送ってよいか確かめてください。</p>
        ) : null}
      </div>
      {rowsFailed ? (
        <p className={styles.schError}>
          予約の一覧を読み込めませんでした。
          <button type="button" data-inbox-v6="scheduled-retry" className={styles.schLink} onClick={onRetryRows}>再読み込み</button>
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className={styles.schGroup}>
          <p className={styles.schLabel}>予約済み（{rows.length}）</p>
          <ul className={styles.schRows}>
            {rows.map((row) => (
              <li key={row.id} data-inbox-v6="scheduled-row" className={styles.schRow}>
                <span className={styles.schRowAt}>{row.label}</span>
                <span className={styles.schRowText} title={row.content}>{row.content}</span>
                <DateTimeField
                  aria-label="予約時刻を変更(日本時間)"
                  defaultValue={row.defaultValue}
                  disabled={!row.editable}
                  onChange={(next) => { if (next) onReschedule(row.id, next) }}
                  className={styles.schRowField}
                />
                <button type="button" className={styles.schLink} disabled={!row.editable} onClick={() => onCancelRow(row.id)}>取消</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  )
}
