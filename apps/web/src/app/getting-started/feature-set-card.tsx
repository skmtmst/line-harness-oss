'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { ApiError, api } from '@/lib/api'
import { FEATURE_SETTINGS_UPDATED_EVENT } from '@/lib/feature-settings'
import { loadFeatureSettings } from '@/lib/feature-settings-cache'
import {
  FEATURE_PRESETS,
  FEATURE_SET_LABELS,
  FEATURE_SET_NOTES,
  featureSetEntry,
  presetApplyReason,
  presetFeatureMap,
  presetTurnsOff,
  presetTurnsOn,
  type FeaturePreset,
} from './feature-presets'

/**
 * 「はじめの設定」の初期セット選択（IDEA-31）。
 *
 * - まだ機能設定を保存していないアカウント（version 0）にだけ picker を出す。
 *   保存済みの設定を初期セットで置き換えることはしない（除外範囲）。
 * - 適用は機能設定の既存APIへ `features` だけを送る。メニューの並び順・
 *   区分の順・保存済みの設定名は送らず、サーバ側でも既存値が保持される。
 * - オフ前の影響確認は既存のサーバ側ゲートが担う。動いている処理が
 *   ある場合はこの画面では適用せず、影響の一覧が出る機能設定へ誘導する。
 */
type CardState =
  | { kind: 'loading' }
  | { kind: 'picker'; version: number; currentFeatures: Record<string, boolean> }
  | { kind: 'configured' }
  | { kind: 'forbidden' }
  | { kind: 'error' }
  | { kind: 'applied'; label: string }

export function FeatureSetCard({ accountId }: { accountId: string | null }) {
  const [state, setState] = useState<CardState>({ kind: 'loading' })
  const [selectedId, setSelectedId] = useState<FeaturePreset['id']>('starter')
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState('')
  /** アカウント切替で古い応答を新しいアカウントへ混ぜない。 */
  const generationRef = useRef(0)

  const load = useCallback(async () => {
    if (!accountId) return
    const generation = ++generationRef.current
    setState({ kind: 'loading' })
    setApplyError('')
    try {
      // サイドバー・機能設定画面と同じ答えを共有する。保存の合図で捨てられる。
      const res = await loadFeatureSettings(accountId)
      if (generationRef.current !== generation) return
      if (!res.success) {
        setState({ kind: 'error' })
        return
      }
      const entry = featureSetEntry({ forbidden: false, version: res.data.version ?? 0 })
      setState(
        entry.kind === 'picker'
          ? { kind: 'picker', version: res.data.version ?? 0, currentFeatures: res.data.features }
          : { kind: entry.kind },
      )
    } catch (error) {
      if (generationRef.current !== generation) return
      setState(
        error instanceof ApiError && error.status === 403
          ? { kind: 'forbidden' }
          : { kind: 'error' },
      )
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const apply = async () => {
    if (!accountId || state.kind !== 'picker' || busy) return
    const preset = FEATURE_PRESETS.find((item) => item.id === selectedId)
    if (!preset) return
    setBusy(true)
    setApplyError('')
    try {
      const res = await api.featureSettings.save(accountId, {
        features: presetFeatureMap(preset),
        expectedVersion: state.version,
        reason: presetApplyReason(preset),
      })
      if (!res.success) {
        setApplyError(res.error || FEATURE_SET_LABELS.saveError)
        return
      }
      /*
       * サイドメニューは FEATURE_SETTINGS_UPDATED_EVENT を購読している。
       * 設定画面と同じ合図を送り、左のメニューを保存結果へ揃える。
       */
      window.dispatchEvent(
        new CustomEvent(FEATURE_SETTINGS_UPDATED_EVENT, { detail: { accountId } }),
      )
      setState({ kind: 'applied', label: preset.label })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409
        && error.code === 'IMPACT_CONFIRMATION_REQUIRED') {
        /*
         * 実行待ち・公開中の処理が残っている機能をオフにしようとした。
         * 影響の一覧を出して確認するのは機能設定の役目なので、ここでは
         * 適用せず誘導する。「隠したのに配信が止まった」と誤認させない。
         */
        setApplyError(FEATURE_SET_LABELS.impactBlocked)
        return
      }
      if (error instanceof ApiError && error.status === 409) {
        setApplyError(FEATURE_SET_LABELS.conflict)
        void load()
        return
      }
      if (error instanceof ApiError && error.status === 403) {
        setState({ kind: 'forbidden' })
        return
      }
      setApplyError(FEATURE_SET_LABELS.saveError)
    } finally {
      setBusy(false)
    }
  }

  if (!accountId) {
    return (
      <section
        aria-label={FEATURE_SET_LABELS.heading}
        className="rounded-card border-hairline bg-canvas border p-4"
      >
        <p className="text-sm leading-relaxed text-ink-secondary">{FEATURE_SET_LABELS.noAccount}</p>
      </section>
    )
  }

  return (
    <section
      aria-label={FEATURE_SET_LABELS.heading}
      className="rounded-card border-hairline bg-canvas flex flex-col gap-3 border p-4"
    >
      <h2 className="text-sm font-bold text-ink">{FEATURE_SET_LABELS.heading}</h2>

      {state.kind === 'loading' && (
        <p className="text-sm leading-relaxed text-ink-secondary">読み込み中…</p>
      )}

      {state.kind === 'error' && (
        <p className="text-sm leading-relaxed text-ink-secondary">
          {FEATURE_SET_LABELS.loadError}
          <button
            type="button"
            onClick={() => void load()}
            className="text-action ml-2 cursor-pointer font-bold underline hover:no-underline"
          >
            {FEATURE_SET_LABELS.retry}
          </button>
        </p>
      )}

      {state.kind === 'forbidden' && (
        <p className="text-sm leading-relaxed text-ink-secondary">{FEATURE_SET_LABELS.forbidden}</p>
      )}

      {state.kind === 'configured' && (
        <p className="text-sm leading-relaxed text-ink-secondary">
          {FEATURE_SET_LABELS.configured}{' '}
          <Link href="/settings" className="text-action font-bold underline">
            {FEATURE_SET_LABELS.openSettings}
          </Link>
        </p>
      )}

      {state.kind === 'applied' && (
        <p role="status" className="text-sm leading-relaxed text-ink-secondary">
          {FEATURE_SET_LABELS.applied(state.label)}{' '}
          <Link href="/settings" className="text-action font-bold underline">
            {FEATURE_SET_LABELS.openSettings}
          </Link>
        </p>
      )}

      {state.kind === 'picker' && (
        <Picker
          currentFeatures={state.currentFeatures}
          selectedId={selectedId}
          busy={busy}
          applyError={applyError}
          onSelect={setSelectedId}
          onApply={() => void apply()}
        />
      )}
    </section>
  )
}

function Picker({ currentFeatures, selectedId, busy, applyError, onSelect, onApply }: {
  currentFeatures: Record<string, boolean>
  selectedId: FeaturePreset['id']
  busy: boolean
  applyError: string
  onSelect: (id: FeaturePreset['id']) => void
  onApply: () => void
}) {
  const selected = FEATURE_PRESETS.find((item) => item.id === selectedId) ?? FEATURE_PRESETS[0]
  const offCount = presetTurnsOff(selected, currentFeatures).length
  const onCount = presetTurnsOn(selected, currentFeatures).length
  return (
    <>
      <p className="text-sm leading-relaxed text-ink-secondary">{FEATURE_SET_LABELS.intro}</p>
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-ink-faint mb-1 text-xs">
          業種・担当業務に近いものを1つ選んでください
        </legend>
        {FEATURE_PRESETS.map((preset) => (
          <label
            key={preset.id}
            className={`rounded-control flex cursor-pointer items-start gap-2.5 border p-3 ${
              preset.id === selectedId
                ? 'border-accent-deep bg-accent-soft'
                : 'border-hairline bg-canvas'
            }`}
          >
            <input
              type="radio"
              name="feature-preset"
              value={preset.id}
              checked={preset.id === selectedId}
              onChange={() => onSelect(preset.id)}
              className="accent-accent-deep mt-0.5"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-bold text-ink">{preset.label}</span>
              <span className="text-xs leading-relaxed text-ink-secondary">{preset.audience}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p aria-live="polite" className="text-sm leading-relaxed text-ink-secondary">
        {offCount === 0 && onCount === 0
          ? 'いまの表示は変わりません。'
          : [
              offCount > 0 ? `いま出ている機能のうち ${offCount}個が非表示になります` : null,
              onCount > 0 ? `${onCount}個が新しく表示されます` : null,
            ]
              .filter(Boolean)
              .join('。')}
      </p>

      <ul className="rounded-control bg-canvas-sunken list-disc space-y-1.5 px-4 py-3 pl-8 text-xs leading-relaxed text-ink-secondary">
        {FEATURE_SET_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      {applyError && (
        <Notice
          tone="danger"
          message={applyError}
          action={applyError === FEATURE_SET_LABELS.impactBlocked ? (
            <Link href="/settings">
              {FEATURE_SET_LABELS.openSettings}
            </Link>
          ) : undefined}
        />
      )}

      <div className="flex justify-end">
        <Button variant="primary" disabled={busy} onClick={onApply}>
          {busy ? FEATURE_SET_LABELS.applying : FEATURE_SET_LABELS.apply}
        </Button>
      </div>
    </>
  )
}
