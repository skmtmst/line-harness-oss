'use client'

/*
 * K-1(#822): 公開の進み。
 *
 * 公開を4つの段（画像を上げる・メニューを作る・友だちに割り当てる・
 * 前のメニューを片付ける）に分けて出す。途中で失敗したら、それまでの段を
 * 元に戻して前のメニューのままにする。失敗した段だけ「失敗」にし、
 * 手を付けていない段は「しない」と出す。
 */

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'

type StepStatus = 'done' | 'failed' | 'running' | 'pending' | 'skipped'

type ProgressStep = { key: string; label: string; status: StepStatus }

/** 段の印と呼び名。色は呼び出し側で直書きする（変数で組むと design-debt に載る）。 */
function stepMark(status: StepStatus): { mark: string; label: string } {
  switch (status) {
    case 'done':
      return { mark: '✓', label: '済み' }
    case 'failed':
      return { mark: '✗', label: '失敗' }
    case 'running':
      return { mark: '…', label: '実行中' }
    case 'skipped':
      return { mark: '—', label: 'しない' }
    case 'pending':
    default:
      return { mark: '○', label: 'しない' }
  }
}

export function PublishProgressSection({
  groupId,
  onRetry,
}: {
  groupId: string
  /** 「もう一度公開する」を押したとき。親の公開操作へつなぐ。 */
  onRetry: () => void
}) {
  const [steps, setSteps] = useState<ProgressStep[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [runFailed, setRunFailed] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.richMenuGroups.publishProgress(groupId)
      if (!res.success) throw new Error(res.error)
      setSteps(res.data.steps)
      setMessage(res.data.message)
      setRunFailed(res.data.run?.status === 'failed')
      setLoadError(false)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) setLoadError(true)
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section aria-label="公開の進み" className="border-hairline bg-canvas rounded-card mt-5 border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ink text-sm font-bold">公開の進み</h2>
        {runFailed ? (
          <Button type="button" variant="primary" onClick={onRetry}>
            もう一度公開する
          </Button>
        ) : null}
      </div>

      {loadError ? (
        <p className="text-ink-faint mt-3 text-xs">公開の進みを読み込めませんでした。</p>
      ) : steps === null ? (
        <p className="text-ink-faint mt-3 text-xs">読み込み中…</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {steps.map((step) => {
              const { mark, label } = stepMark(step.status)
              // 色は className の中に直書きする（変数に入れると design-debt に載る）。
              return (
                <li key={step.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">
                    <span
                      aria-hidden
                      className={
                        step.status === 'done'
                          ? 'mr-2 text-success'
                          : step.status === 'failed'
                            ? 'mr-2 text-danger'
                            : step.status === 'running'
                              ? 'mr-2 text-ink-secondary'
                              : 'mr-2 text-ink-faint'
                      }
                    >
                      {mark}
                    </span>
                    {step.label}
                  </span>
                  <span
                    className={
                      step.status === 'done'
                        ? 'shrink-0 text-xs text-success'
                        : step.status === 'failed'
                          ? 'shrink-0 text-xs text-danger'
                          : step.status === 'running'
                            ? 'shrink-0 text-xs text-ink-secondary'
                            : 'shrink-0 text-xs text-ink-faint'
                    }
                  >
                    {label}
                  </span>
                </li>
              )
            })}
          </ul>
          {message ? (
            <p className="text-ink-secondary mt-3 text-xs leading-5">{message}</p>
          ) : null}
        </>
      )}
    </section>
  )
}
