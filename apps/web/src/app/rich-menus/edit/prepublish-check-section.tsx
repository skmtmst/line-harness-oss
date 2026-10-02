'use client'

/*
 * O-1(#822): 公開の前の確認。
 *
 * 公開の前に確かめる4つ（自前の検査・LINEの検査・実機で見た・ページ数）を
 * 並べる。プレビューだけでは公開できず、担当者がスマートフォンの実機で
 * 見て「実機で見た」を押すまで、公開の門番が止める。
 */

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'

type Check = {
  key: string
  label: string
  state: 'ok' | 'ng' | 'yet'
  message: string | null
  help?: { label: string; body: string }
}

export function PrepublishCheckSection({ groupId }: { groupId: string }) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [validating, setValidating] = useState(false)
  const [recording, setRecording] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.richMenuGroups.prepublishCheck(groupId)
      if (!res.success) throw new Error(res.error)
      const data = res.data
      setChecks([
        {
          key: 'self',
          label: '自前の検査',
          state: data.selfCheck.ok ? 'ok' : 'ng',
          message: data.selfCheck.ok ? null : data.selfCheck.message,
          help: {
            label: '自前の検査の説明',
            body: '未設定・重なり・画像・参照先・文字数・領域数の検査です。',
          },
        },
        {
          key: 'line',
          label: 'LINEの検査',
          state: 'yet',
          message: '下の「LINEの検査を通す」で確認します。',
        },
        {
          key: 'device',
          label: '実機で見た',
          state: data.deviceConfirmed ? 'ok' : 'yet',
          message: data.deviceConfirmed
            ? 'スマートフォンの実機で確認済みです。'
            : 'まだ確認がありません。下のボタンで記録します。',
          help: {
            label: '実機で見たの説明',
            body: '管理画面のプレビューだけでは公開できません。スマートフォンのLINEで見た担当者が押します。',
          },
        },
        {
          key: 'pages',
          label: 'ページ数',
          state: data.pageCount <= data.maxPages ? 'ok' : 'ng',
          message:
            data.pageCount <= data.maxPages
              ? `${data.pageCount}ページ（上限${data.maxPages}ページ）`
              : `${data.pageCount}ページあり、上限${data.maxPages}ページを超えています。`,
        },
      ])
      setLoadError(false)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) setLoadError(true)
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  function patchCheck(key: string, patch: Partial<Check>) {
    setChecks((prev) => prev?.map((c) => (c.key === key ? { ...c, ...patch } : c)) ?? null)
  }

  async function validateWithLine() {
    if (validating) return
    setValidating(true)
    setActionError('')
    try {
      const res = await api.richMenuGroups.validatePublish(groupId)
      if (!res.success) throw new Error(res.error)
      const line = res.data.checks.find((c) => c.key === 'line')
      const self = res.data.checks.find((c) => c.key === 'self')
      if (self && !self.ok) {
        patchCheck('self', { state: 'ng', message: self.message })
      }
      patchCheck('line', {
        state: line?.ok ? 'ok' : 'ng',
        message: line?.ok ? 'LINEの検査を通りました。' : (line?.message ?? 'LINEの検査を通りませんでした。'),
      })
    } catch {
      setActionError('LINEの検査を通せませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setValidating(false)
    }
  }

  async function recordSeen() {
    if (recording) return
    setRecording(true)
    setActionError('')
    try {
      const res = await api.richMenuGroups.confirmDevice(groupId)
      if (!res.success) throw new Error(res.error)
      patchCheck('device', { state: 'ok', message: 'スマートフォンの実機で確認済みです。' })
    } catch {
      setActionError('実機で見た記録を残せませんでした。もう一度お試しください。')
    } finally {
      setRecording(false)
    }
  }

  const mark = (state: Check['state']) =>
    state === 'ok' ? (
      <span aria-hidden className="text-success mr-2">✓</span>
    ) : state === 'ng' ? (
      <span aria-hidden className="text-danger mr-2">✗</span>
    ) : (
      <span aria-hidden className="text-ink-faint mr-2">○</span>
    )

  return (
    <section aria-label="公開の前の確認" className="border-hairline bg-canvas rounded-card border p-5">
      <h2 className="text-ink text-sm font-bold">公開の前の確認</h2>

      {loadError ? (
        <p className="text-ink-faint mt-2 text-xs">確認の状態を読み込めませんでした。</p>
      ) : checks === null ? (
        <p className="text-ink-faint mt-2 text-xs">読み込み中…</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2 text-sm">
            {checks.map((check) => (
              <li key={check.key}>
                <span className="text-ink">
                  {mark(check.state)}
                  {check.label}
                </span>
                {check.help ? <HelpTip label={check.help.label}>{check.help.body}</HelpTip> : null}
                {check.message ? (
                  <span className="text-ink-faint ml-1 block text-xs">{check.message}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void validateWithLine()} disabled={validating} busy={validating} busyLabel="確認中…">LINEの検査を通す
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void recordSeen()}
              disabled={recording} busy={recording} busyLabel="記録中…">実機で見た
            </Button>
          </div>
          {actionError ? <p role="alert" className="text-danger mt-2 text-xs">{actionError}</p> : null}
        </>
      )}
    </section>
  )
}
