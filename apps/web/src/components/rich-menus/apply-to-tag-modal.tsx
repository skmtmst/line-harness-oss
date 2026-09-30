'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'

type Tag = { id: string; name: string; color: string }

type Props = {
  groupId: string
  groupName: string
  onClose: () => void
}

type Mode =
  | { kind: 'tag'; tagId: string }
  | { kind: 'all-followers' }
  | { kind: 'set-default' }

export function ApplyToTagModal({ groupId, groupName, onClose }: Props) {
  const [tags, setTags] = useState<Tag[]>([])
  const [mode, setMode] = useState<Mode>({ kind: 'all-followers' })
  /*
    #502中: 一括適用の冪等キー。窓を開いたときと条件を変えたときに振り直す。
    失敗後の「やり直す」は同じ鍵を使い回す——同じ鍵のやり直しは台帳へ
    重複記録されない。新しい実行のたびに変える。
  */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  function pickMode(next: Mode) {
    setMode(next)
    setIdempotencyKey(crypto.randomUUID())
  }
  // タグが読めない理由を黙らせない。失敗時は注記と再試しを出す。
  const [tagsLoadError, setTagsLoadError] = useState(false)
  const [tagsLoading, setTagsLoading] = useState(true)
  const loadTags = () => {
    setTagsLoading(true)
    setTagsLoadError(false)
    api.tags
      .list()
      .then((r) => {
        if (r.success) setTags(r.data ?? [])
        else setTagsLoadError(true)
      })
      .catch(() => {
        setTagsLoadError(true)
      })
      .finally(() => {
        setTagsLoading(false)
      })
  }
  const [phase, setPhase] = useState<'config' | 'running' | 'done' | 'error'>(
    'config',
  )
  // 一括適用の走っている最中はEscapeで窓だけ消えないようにする。
  const panelRef = useOverlayFocus(true, onClose, phase === 'running')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    chunks: number
    total: number
    message?: string
    mode?: string
  } | null>(null)
  const [confirmingDefault, setConfirmingDefault] = useState(false)
  const [defaultBusy, setDefaultBusy] = useState(false)
  const [defaultError, setDefaultError] = useState('')

  // 初回だけ読む。再試しは失敗注記のボタンから loadTags を直接呼ぶ。
  useEffect(() => {
    loadTags()
  }, [])

  /*
    「全員のデフォルト」は影響範囲が大きいので設計の確認窓で聞く。
    **ブラウザの `confirm()` を使わない。** 何が表示され、どのメニューの
    設定が外れるかを本文で読ませられず、画像比較にも写らない。

    設定そのものは別のメニューを選び直せば戻せる（データは消えない）ので
    `destructive` は付けない。ただし**前に既定だったメニューは記録されない**
    ことを本文に書いて、押す前に控えさせる。
  */
  function apply() {
    if (mode.kind === 'set-default') {
      setDefaultError('')
      setConfirmingDefault(true)
      return
    }
    void runApply()
  }

  async function confirmSetDefault() {
    if (defaultBusy) return
    setDefaultBusy(true)
    setDefaultError('')
    try {
      const res = await api.richMenuGroups.applyToTag(groupId, { mode: 'set-default' })
      if (!res.success) throw new Error(res.error ?? '適用失敗')
      setResult(res.data)
      setConfirmingDefault(false)
      setPhase('done')
    } catch {
      setDefaultError('全員のデフォルトに設定できませんでした。いまの表示は変わっていません。時間をおいて、もう一度お試しください。')
    } finally {
      setDefaultBusy(false)
    }
  }

  async function runApply() {
    setPhase('running')
    setError(null)
    try {
      const params =
        mode.kind === 'tag'
          ? { mode: 'bulk-link' as const, tagId: mode.tagId }
          : mode.kind === 'all-followers'
            ? { mode: 'bulk-link' as const, tagId: null }
            : { mode: 'set-default' as const }
      // やり直しは同じ鍵——二重送信・記録重複にしない。条件を変えたら鍵も変わる。
      const res = await api.richMenuGroups.applyToTag(groupId, params, idempotencyKey)
      if (!res.success) throw new Error(res.error ?? '適用失敗')
      setResult(res.data)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  return (
    <div className="fixed inset-0 bg-scrim flex items-center justify-center z-50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-to-tag-title"
        className="bg-canvas rounded-control shadow-float w-full max-w-md"
      >
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <h2 id="apply-to-tag-title" className="text-lg font-semibold text-ink">
              友だちにこのメニューを表示
            </h2>
            <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <p className="text-sm text-ink-faint mb-5 break-all">「{groupName}」</p>

          {phase === 'config' && (
            <>
              <div className="mb-5">
                <RadioCardGroup legend="適用する相手" className="grid gap-2">
                  <RadioCard
                    name="apply-mode"
                    value="all-followers"
                    checked={mode.kind === 'all-followers'}
                    onChange={() => pickMode({ kind: 'all-followers' })}
                    title="このアカウントの全員に適用"
                    note="現時点で friend 状態の友だち全員に LINE のメニューを link します。新規友だちには適用されません。"
                  />
                  <RadioCard
                    name="apply-mode"
                    value="tag"
                    checked={mode.kind === 'tag'}
                    disabled={tags.length === 0}
                    disabledReason={tagsLoading ? 'タグを読み込んでいます' : '使えるタグがありません'}
                    onChange={() =>
                      pickMode({
                        kind: 'tag',
                        tagId: tags[0]?.id ?? '',
                      })
                    }
                    title="タグで絞り込んで適用"
                    note="指定したタグを持つ友だちだけに表示します。"
                  />
                  <RadioCard
                    name="apply-mode"
                    value="set-default"
                    checked={mode.kind === 'set-default'}
                    onChange={() => pickMode({ kind: 'set-default' })}
                    title="全員のデフォルトに設定する"
                    note="LINE 公式アカウントのデフォルトメニューにします。新規友だちも含め全員に自動で表示されます。同じアカウント内の他のメニューのデフォルト設定は解除されます。"
                  />
                </RadioCardGroup>
                {mode.kind === 'tag' && (
                  <div className="mt-2">
                    <Select
                      value={mode.tagId}
                      onChange={(value) =>
                        pickMode({ kind: 'tag', tagId: value })
                      }
                      aria-label="適用するタグ"
                      options={
                        tags.length === 0
                          ? [{ value: '', label: tagsLoading ? 'タグを読み込んでいます' : 'タグがありません' }]
                          : tags.map((t) => ({ value: t.id, label: t.name }))
                      }
                      size="full"
                    />
                    {tagsLoadError && (
                      <p className="text-ink-faint mt-2 text-xs">
                        タグを読み込めませんでした。タグの絞り込みは使えません。
                        <button
                          type="button"
                          onClick={loadTags}
                          className="text-action ml-1 font-medium underline"
                        >
                          もう一度読み込む
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" className="px-4 py-2 font-medium hover:bg-surface-pearl h-auto whitespace-normal" onClick={onClose}>
                  キャンセル
                </Button>
                <button
                  onClick={apply}
                  disabled={mode.kind === 'tag' && !mode.tagId}
                  className="px-4 py-2 text-sm font-medium text-on-accent rounded-control disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  実行する
                </button>
              </div>
            </>
          )}

          {phase === 'running' && (
            <div className="text-center py-10 text-sm text-ink-faint">
              <div className="mb-2">適用中...</div>
              <div className="text-xs text-ink-faint">
                LINE Messaging API に送信しています
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <>
              <div className="bg-accent-soft border border-accent-border text-success text-sm p-4 rounded-control mb-4">
                <div className="font-medium mb-1">✓ 完了しました</div>
                <div className="text-xs">
                  {result.message ??
                    `${result.total} 名の友だちに適用しました (${result.chunks} chunk)`}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-on-accent rounded-control transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  閉じる
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="bg-danger-bg border border-status-danger-border text-danger text-sm p-4 rounded-control mb-4">
                {error}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" className="px-4 py-2 font-medium hover:bg-surface-pearl h-auto whitespace-normal" onClick={onClose}>
                  閉じる
                </Button>
                <button
                  onClick={() => setPhase('config')}
                  className="px-4 py-2 text-sm font-medium text-on-accent rounded-control transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  やり直す
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDefault}
        title={`「${groupName}」を全員のデフォルトにしますか？`}
        description="特別な設定をしていない友だち全員のトーク画面に、このメニューが出るようになります。これから友だちになる人にも出ます。同じLINE公式アカウントで別のメニューがデフォルトになっていた場合、そちらの設定は外れます。前にどのメニューがデフォルトだったかは記録されないので、戻したいときは自分で選び直すことになります。すでにタグや個別の指定でメニューを割り当てている友だちには、そちらが優先されます。"
        confirmLabel="全員のデフォルトにする"
        busy={defaultBusy}
        error={defaultError}
        onConfirm={() => void confirmSetDefault()}
        onCancel={() => {
          if (defaultBusy) return
          setDefaultError('')
          setConfirmingDefault(false)
        }}
      />
    </div>
  )
}
