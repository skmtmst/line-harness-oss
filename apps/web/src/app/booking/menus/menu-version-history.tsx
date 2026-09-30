'use client'

import { useCallback, useEffect, useState } from 'react'
import Drawer from '@/components/shared/drawer'
import ListState from '@/components/shared/list-state'
import VersionCompare from '@/components/shared/version-compare'
import VersionHistory, { type HistoryVersion } from '@/components/shared/version-history'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { notifyToast } from '@/components/shared/toast'
import { ApiError, bookingApi, type BookingMenuVersion } from '@/lib/api'

/**
 * T: 予約メニューの版の履歴（右から出る欄）。
 * 版そのものは共通部品（VersionHistory・VersionCompare）で見せる。
 * この引き出しは読み・比べ・戻すの配線だけを持つ。
 */
export default function MenuVersionHistory({
  menuId,
  menuName,
  currentVersion,
  accountId,
  canRevert,
  onReverted,
  onClose,
}: {
  menuId: string
  menuName: string
  currentVersion: number
  accountId: string
  canRevert: boolean
  onReverted: (version: number) => void
  onClose: () => void
}) {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [versions, setVersions] = useState<BookingMenuVersion[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [comparing, setComparing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadState('loading')
    setRevertError(null)
    try {
      const response = await bookingApi.listMenuVersions(accountId, menuId)
      const list = Array.isArray(response.versions) ? response.versions : []
      setVersions(list)
      setSelected((current) => {
        if (current != null && list.some((v) => v.version_number === current)) return current
        return list[0]?.version_number ?? null
      })
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [accountId, menuId])

  useEffect(() => {
    void load()
  }, [load])

  const history: HistoryVersion[] = versions.map((version) => ({
    versionNumber: version.version_number,
    title: version.title,
    status: version.status === 'in_use' ? 'in_use' : 'past',
    statusNote: version.status === 'in_use' ? 'いま使っている' : null,
    summary: version.summary,
    author: version.author,
    at: version.at,
  }))
  const selectedVersion = versions.find((v) => v.version_number === selected) ?? null
  const current = versions.find((v) => v.version_number === currentVersion)
    ?? versions.find((v) => v.status === 'in_use') ?? null

  const doRevert = async () => {
    if (selected == null) return
    setConfirming(false)
    setReverting(true)
    setRevertError(null)
    try {
      const response = await bookingApi.revertMenuVersion(accountId, menuId, selected, currentVersion)
      notifyToast(`第${selected}版の中身で新しい版（第${response.version}版）を作りました。`)
      onReverted(response.version)
      await load()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setRevertError('ほかの人が先に保存しました。最新の版を読み直してから、もう一度お試しください。')
        await load()
      } else if (error instanceof ApiError && error.status === 403) {
        setRevertError('版を戻す権限がありません。')
      } else {
        setRevertError('版を戻せませんでした。通信状態を確認して、もう一度お試しください。')
      }
    } finally {
      setReverting(false)
    }
  }

  return (
    <Drawer
      open
      title={`「${menuName}」の版の履歴`}
      description="保存するたびに版が1つ増えます。前の版は変わりません。"
      busy={reverting}
      onClose={onClose}
    >
      {loadState === 'loading' ? (
        <ListState kind="loading" title="版の履歴を読み込んでいます" />
      ) : loadState === 'error' ? (
        <ListState
          kind="error"
          title="版の履歴"
          description="版の履歴を読み込めませんでした。"
          onRetry={() => void load()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {revertError ? (
            <p role="alert" className="text-danger text-xs">{revertError}</p>
          ) : null}
          <VersionHistory
            versions={history}
            selectedVersionNumber={selected}
            onSelect={(versionNumber) => {
              setSelected(versionNumber)
              setComparing(false)
            }}
            compareLabel="いまと比べる"
            onCompare={() => setComparing(true)}
            revertLabel="この版に戻す"
            onRevert={() => setConfirming(true)}
            canRevert={canRevert}
            revertDisabledReason={canRevert ? undefined : '版を戻す権限がありません。'}
            busy={reverting}
          />
          {comparing && selectedVersion ? (
            <section aria-label="版の比べ">
              <h3 className="text-ink mb-2 text-sm font-semibold">
                {selectedVersion.title}と{current?.title ?? 'いまの版'}の比べ
              </h3>
              <VersionCompare
                before={selectedVersion.lines.join('\n')}
                after={(selectedVersion.version_number === current?.version_number
                  ? selectedVersion
                  : current)?.lines.join('\n') ?? ''}
              />
            </section>
          ) : null}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={`第${selected}版に戻しますか？`}
        description="いまの版は残ります。この版の中身で新しい版を作ります。"
        confirmLabel="新しい版を作る"
        cancelLabel="キャンセル"
        busy={reverting}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void doRevert()}
      />
    </Drawer>
  )
}
