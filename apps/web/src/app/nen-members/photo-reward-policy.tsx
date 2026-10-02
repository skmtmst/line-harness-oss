'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Drawer from '@/components/shared/drawer'
import HelpTip from '@/components/shared/help-tip'
import VersionCompare from '@/components/shared/version-compare'
import VersionHistory, { type HistoryVersion } from '@/components/shared/version-history'
import { api, type PhotoRewardPolicyVersion } from '@/lib/api'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { formatPhotoReceivedAt } from './photo-review-time'
import { formatDay } from '@/lib/format'

/*
 * #817: 報酬の決まりの版。一覧の右の棚に置く小箱と、版の履歴の棚。
 * 版の部品（VersionHistory・VersionCompare）は #820 と同じものを使う。
 * 決まりは全体で1つ。見るだけなら審査の表示権限で足り、
 * 変えるのは owner・admin だけ（口が 403 で止める）。
 */

function policyLines(version: PhotoRewardPolicyVersion): string {
  return [
    `報酬：採用1枚につき ${version.points}pt`,
    `ひとこと：${version.summary || '—'}`,
    `使い始め：${version.effectiveFrom ? formatPhotoReceivedAt(version.effectiveFrom) : '公開と同時'}`,
  ].join('\n')
}

function shortStart(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatDay(date)
}

export function PhotoRewardPolicyCard({
  onCurrentPointsChange,
}: {
  /** いま使っている版の点数。一覧のまとめ採用の合計に使う。未取得は null。 */
  onCurrentPointsChange?: (points: number | null) => void
}) {
  const [versions, setVersions] = useState<PhotoRewardPolicyVersion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.nenMembers.photoRewardPolicyVersions()
      if (!res.success) throw new Error(res.error)
      setVersions(res.data)
      const current = res.data.find((v) => v.status === 'in_use') ?? null
      onCurrentPointsChange?.(current ? current.points : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '報酬の決まりを読み込めませんでした')
      onCurrentPointsChange?.(null)
    } finally {
      setLoading(false)
    }
  }, [onCurrentPointsChange])

  useEffect(() => { void load() }, [load])

  const current = versions?.find((v) => v.status === 'in_use') ?? null

  /*
   * 右の棚の小箱と見た目をそろえる（枠・角丸・地・余白は同じ）。
   * design-debt の未解決に数えないよう、静的な文字だけで書く。
   */
  return (
    <section aria-label="報酬の決まり" className="rounded-card border border-hairline bg-canvas p-4">
      <h2 className="flex items-center gap-1 text-xs font-bold text-ink">
        報酬の決まり
        <HelpTip label="報酬の決まりの説明">
          採用1枚につき付ける点数の決まりです。保存するたびに版が1つ増え、前の版は変わりません。採用した時点の版を付与の記録に写すので、版を変えても過去の付与は変わりません。
        </HelpTip>
      </h2>
      {loading || error || !current ? (
        <p className="mt-2 text-3xl font-bold text-ink-faint">—</p>
      ) : (
        <p className="mt-2 truncate text-3xl font-bold text-ink-faint" title={`採用1枚につき ${current.points}マイル（第${current.versionNumber}版）`}>
          {current.points}マイル
        </p>
      )}
      <p className="mt-1 text-xs font-medium leading-relaxed text-ink-faint">
        {loading
          ? '読み込んでいます'
          : error
            ? '読み込めませんでした'
            : current
              ? `採用1枚につき・第${current.versionNumber}版です。採用した時点の版を付与の記録に写します。`
              : 'まだ決まりがありません'}
      </p>
      {!loading && !error && (
        <Button variant="secondary" size="field" className="mt-2" onClick={() => setHistoryOpen(true)}>
          版の履歴を見る
        </Button>
      )}
      {error && (
        <Button variant="secondary" size="field" className="mt-2" onClick={() => void load()}>
          もう一度読み込む
        </Button>
      )}
      <PhotoRewardPolicyDrawer
        open={historyOpen}
        versions={versions}
        loading={loading}
        error={error}
        onReload={() => void load()}
        onClose={() => setHistoryOpen(false)}
        onChanged={() => void load()}
      />
    </section>
  )
}

function PhotoRewardPolicyDrawer({
  open,
  versions,
  loading,
  error,
  onReload,
  onClose,
  onChanged,
}: {
  open: boolean
  versions: PhotoRewardPolicyVersion[] | null
  loading: boolean
  error: string
  onReload: () => void
  onClose: () => void
  onChanged: () => void
}) {
  /*
   * N-144 と同じく、押すと 403 になる口は出さない。
   * 見るだけの人には履歴と比べるだけ残す。
   */
  const [canMutate] = useState(() => (typeof window === 'undefined' ? true : isOwnerOrAdmin()))
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [comparing, setComparing] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [pointsInput, setPointsInput] = useState('')
  const [summaryInput, setSummaryInput] = useState('')
  const [effectiveInput, setEffectiveInput] = useState('')

  const selected = versions?.find((v) => v.versionNumber === selectedVersion) ?? null
  // 版そのものは持たない。いま使っている版と選んだ版を比べる。
  const inUse = versions?.find((v) => v.status === 'in_use') ?? null

  const doRevert = useCallback(async () => {
    if (reverting || selectedVersion === null) return
    setReverting(true)
    setRevertError('')
    try {
      const res = await api.nenMembers.revertPhotoRewardPolicyVersion({ versionNumber: selectedVersion })
      if (!res.success) throw new Error(res.error)
      setRevertOpen(false)
      setSelectedVersion(res.data.version.versionNumber)
      setComparing(false)
      onChanged()
    } catch (e) {
      setRevertError(e instanceof Error ? e.message : '戻せませんでした')
    } finally {
      setReverting(false)
    }
  }, [reverting, selectedVersion, onChanged])

  const doCreate = useCallback(async () => {
    if (creating) return
    const points = Number(pointsInput)
    if (!Number.isInteger(points) || points < 1 || points > 100000) {
      setCreateError('1枚につき付ける点数を1〜100000で入力してください')
      return
    }
    if (effectiveInput && Number.isNaN(Date.parse(effectiveInput))) {
      setCreateError('使い始めの日時の形を確認してください')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const latest = versions?.[0]?.versionNumber
      const res = await api.nenMembers.createPhotoRewardPolicyVersion({
        points,
        summary: summaryInput.trim(),
        effectiveFrom: effectiveInput || null,
        ...(latest !== undefined ? { expectedVersion: latest } : {}),
      })
      if (!res.success) throw new Error(res.error)
      setPointsInput('')
      setSummaryInput('')
      setEffectiveInput('')
      setSelectedVersion(res.data.version.versionNumber)
      setComparing(false)
      onChanged()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : '保存できませんでした')
    } finally {
      setCreating(false)
    }
  }, [creating, pointsInput, summaryInput, effectiveInput, versions, onChanged])

  return (
    <>
      <Drawer
        open={open}
        title="版の履歴"
        description="保存するたびに版が1つ増えます。前の版は変わりません。この版に戻すは、その中身で新しい版を作ります。"
        onClose={() => {
          if (reverting || creating) return
          onClose()
        }}
      >
        {loading ? (
          <p className="text-xs text-ink-faint">読み込み中...</p>
        ) : error ? (
          <div>
            <p className="text-xs text-ink-secondary">{error}</p>
            <Button variant="secondary" onClick={onReload} className="mt-2">
              もう一度読み込む
            </Button>
          </div>
        ) : (
          <>
            <VersionHistory
              versions={(versions ?? []).map((v): HistoryVersion => ({
                versionNumber: v.versionNumber,
                title: `第${v.versionNumber}版`,
                status: v.status,
                statusNote:
                  v.status === 'reserved' && v.effectiveFrom && shortStart(v.effectiveFrom)
                    ? `${shortStart(v.effectiveFrom)}から使う`
                    : v.status === 'in_use'
                      ? 'いま使っている'
                      : null,
                summary: v.summary || `${v.points}pt`,
                at: formatPhotoReceivedAt(v.createdAt),
              }))}
              selectedVersionNumber={selectedVersion}
              onSelect={(n) => {
                setSelectedVersion(n)
                setComparing(false)
              }}
              compareLabel={selectedVersion === null ? '比べる' : `第${selectedVersion}版と比べる`}
              onCompare={() => setComparing(true)}
              revertLabel={selectedVersion === null ? '戻す' : `第${selectedVersion}版に戻す`}
              onRevert={() => {
                setRevertError('')
                setRevertOpen(true)
              }}
              canRevert={
                canMutate
                && selectedVersion !== null
                && (versions ?? []).find((v) => v.versionNumber === selectedVersion)?.status !== 'in_use'
              }
              revertDisabledReason={
                !canMutate
                  ? '編集の権限がありません'
                  : 'いま使っている版です'
              }
              busy={reverting || creating}
            />
            {comparing && selected && inUse && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-ink">
                  いま使っている版と第{selected.versionNumber}版を比べる
                </p>
                <VersionCompare before={policyLines(inUse)} after={policyLines(selected)} />
              </div>
            )}
            {canMutate && (
              <div className="mt-4 border-t border-hairline pt-3">
                <p className="flex items-center gap-1 text-xs font-semibold text-ink">
                  新しい版を作る
                  <HelpTip label="新しい版の説明">
                    点数・ひとこと・使い始めを入れて保存すると、新しい版になります。使い始めを空にすると、保存したときから使います。未来の日時にすると予約の札で見せます。
                  </HelpTip>
                </p>
                <label className="mt-2 block text-xs font-semibold text-ink">
                  採用1枚につき付ける点数
                  <input
                    value={pointsInput}
                    onChange={(event) => { setPointsInput(event.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setCreateError('') }}
                    inputMode="numeric"
                    placeholder="例：10"
                    className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <label className="mt-2 block text-xs font-semibold text-ink">
                  ひとこと（版の中身）
                  <input
                    value={summaryInput}
                    onChange={(event) => { setSummaryInput(event.target.value.slice(0, 200)); setCreateError('') }}
                    placeholder="例：報酬を5pt→10ptに"
                    className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <label className="mt-2 block text-xs font-semibold text-ink">
                  使い始め（空なら保存したときから）
                  <input
                    type="datetime-local"
                    value={effectiveInput}
                    onChange={(event) => { setEffectiveInput(event.target.value); setCreateError('') }}
                    className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                {createError && <p className="mt-2 text-xs text-danger">{createError}</p>}
                <Button variant="primary" disabled={creating} onClick={() => void doCreate()} className="mt-2" busy={creating} busyLabel="保存中...">新しい版を保存する
                </Button>
              </div>
            )}
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={revertOpen}
        title={`第${selectedVersion}版に戻しますか？`}
        description="過去の版は変わりません。その中身で新しい版を作ります。採用済みの付与は、いま写っている版のまま変わりません。"
        confirmLabel="この版に戻す"
        busy={reverting}
        error={revertError}
        onConfirm={() => void doRevert()}
        onCancel={() => {
          if (reverting) return
          setRevertOpen(false)
          setRevertError('')
        }}
      />
    </>
  )
}
