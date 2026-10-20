'use client'

import Button from '@/components/shared/button'
import { type CommonVarDetail } from '@/lib/api'
import type { CommonVarSchedule } from '@line-crm/shared'
import { Plus,X } from 'lucide-react'
import type { Dispatch,SetStateAction } from 'react'
import { jstNowLocalInput } from './edit-model'
import { scheduleStamp } from './edit-text'
import styles from './edit.module.css'

type RenderScheduleCardContext = {
  canWrite: boolean
  item: CommonVarDetail | null
  loadSchedules: (varId: string, accountId: string) => Promise<void>
  removeSchedule: (scheduleId: string) => Promise<void>
  schedules: CommonVarSchedule[]
  schedulesError: boolean
  selectedAccountId: string | null
  setClearSchedulesError: Dispatch<SetStateAction<string>>
  setClearSchedulesOpen: Dispatch<SetStateAction<boolean>>
  setDraft: Dispatch<SetStateAction<{ date: string; time: string; value: string; } | null>>
  value: string
}

export function renderScheduleCard({ canWrite, item, loadSchedules, removeSchedule, schedules, schedulesError, selectedAccountId, setClearSchedulesError, setClearSchedulesOpen, setDraft, value }: RenderScheduleCardContext) {
  return (item ? (
    <section className={styles.schedCard} aria-labelledby="cv-edit-schedule-heading">
      <h2 id="cv-edit-schedule-heading" className={styles.schedTitle}>決めた日に変える</h2>
      <p className={styles.schedNote}>今すぐではなく、決めた日から新しい中身にできます。</p>
      {schedulesError ? (
        <div className={styles.inlineError} data-schedules-state="error">
          <p className={styles.fieldHint}>更新の予定を読み込めませんでした。いまの値のまま保存できます。</p>
          <Button
            type="button"
            onClick={() => {
              if (item && selectedAccountId) return loadSchedules(item.id, selectedAccountId)
            }}
           busyLabel="処理中…">
            再読み込み
          </Button>
        </div>
      ) : (
        <>
          {schedules.length > 0 ? (
            <dl className={styles.kv}>
              {schedules.map((schedule) => (
                <div key={schedule.id} className={styles.kvRow}>
                  <dt>{`${scheduleStamp(schedule.effectiveFrom)} から`}</dt>
                  <dd title={schedule.value || '（空）'}>{schedule.value || '（空）'}</dd>
                  {canWrite && schedules.length > 1 ? (
                    <button type="button" className={styles.kvRemove} onClick={() => void removeSchedule(schedule.id)} aria-label={`${scheduleStamp(schedule.effectiveFrom)} からの予定を消す`}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </dl>
          ) : null}
          {canWrite ? (
            <div className={styles.schedActions}>
              <Button
                variant="text"
                size="slot"
                type="button"
                onClick={() => {
                  const now = jstNowLocalInput()
                  setDraft({ date: now.date, time: '00:00', value })
                }}
              >
                <Plus size={14} aria-hidden="true" />
                予定を足す
              </Button>
              {/* 予定が1つなら行に×を置かず（絵の行は日時と値だけ）、ここから消す。 */}
              {schedules.length > 0 ? (
                <Button
                  variant="text"
                  size="slot"
                  type="button"
                  onClick={() => {
                    setClearSchedulesError('')
                    setClearSchedulesOpen(true)
                  }}
                >
                  {schedules.length > 1 ? '予定をすべて消す' : '予定を消す'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  ) : null)
}
