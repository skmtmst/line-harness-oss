'use client'

/*
 * シナリオの書きかけをサーバーの下書きの口（API-9 `/api/scenario-drafts/:key`）へ残す（★V8）。
 *
 * 本物のシナリオ・通とは別の行に置く。配信には使わず、30日で消える。
 * 名前と配信方式を決めるまで本物のシナリオの行を作らない決まり（N-055）は変えない。
 *
 * - 入力が止まって2秒で保存（一斉配信・テンプレートと同じ間合い。useDraftAutosave を使う）
 * - 帯は「下書き保存済み・n秒前」。失敗は帯に出し、同じ入力で繰り返さない
 * - 版：新規は expectedVersion 0、以降は返った UUID の version（数値にしない）
 * - 409（ほかのタブ・人が先に書いた）：最新を1回読んで競合の帯を出す。古い入力で勝手に上書きしない
 * - 開き直したとき、保存済みの形と違う下書きがあれば「前の入力を戻す」を出す（決める前は上書きしない）
 * - 以前このブラウザ（localStorage）に残した書きかけがあれば、一度だけサーバーへ移して消す
 * - 保存済みの形に戻ったら下書きを消す。本物を保存した・キャンセル・「捨てる」でも消す
 * - 閲覧のみ（active=false）・アカウントが決まらないときは読みも書きもしない
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScenarioDraft } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { readBrowserDraft, removeBrowserDraft } from './use-browser-draft'
import { AUTOSAVE_WORDS, savedAgoLabel, useDraftAutosave } from './use-draft-autosave'

const CLOCK_TICK_MS = 10_000
const NEW_KEY_POINTER = 'lh:v8-draft-key:scenario-create:'

export const SCENARIO_DRAFT_WORDS = {
  failed: '下書きを自動保存できませんでした。入力を続けると、もう一度保存します',
  conflict: (ago: string) => `ほかの画面でこの下書きが先に保存されました（${ago}）。自分の入力はまだ残っています。`,
  loadLatest: '最新の下書きを読み込む',
  closeToOverwrite: '閉じると自分の入力で上書きします。',
} as const

/** 既存のシナリオ・通の下書きのキー。シナリオIDと通IDから作る。 */
export function scenarioDraftKey(scenarioId: string, part: 'info' | 'first-step' | { stepId: string | null }): string {
  if (typeof part === 'string') return `scenario:${scenarioId}:${part}`
  return `scenario:${scenarioId}:step:${part.stepId ?? 'new'}`
}

function pointerKey(accountId: string): string {
  return NEW_KEY_POINTER + accountId
}

function newUuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // 古い環境の予備（版の照合には使わない。キーとして重ならなければよい）。
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

/**
 * まだシナリオの行が無い「作る①」の下書きのキー。画面が UUID を作り、
 * 開き直したときに同じ下書きへ戻れるよう、キー（中身ではない）だけをこのブラウザに覚える。
 */
export function newScenarioDraftKey(accountId: string): string {
  try {
    const known = globalThis.localStorage.getItem(pointerKey(accountId))
    if (known) return known
    const key = `new:${newUuid()}`
    globalThis.localStorage.setItem(pointerKey(accountId), key)
    return key
  } catch {
    return `new:${newUuid()}`
  }
}

/** 本物のシナリオを作った・キャンセルしたあと、次の「作る①」を新しい下書きで始める。 */
export function forgetNewScenarioDraftKey(accountId: string | null | undefined): void {
  if (!accountId) return
  try {
    globalThis.localStorage.removeItem(pointerKey(accountId))
  } catch {
    /* 消せなくても画面は続ける */
  }
}

type Remote<T> = { value: T; savedAt: number; version: string }

function toRemote<T>(draft: ScenarioDraft): Remote<T> | null {
  const content = draft.content as { value?: unknown } | null
  if (!content || typeof content !== 'object' || !('value' in content)) return null
  const at = Date.parse(draft.updatedAt)
  return { value: content.value as T, savedAt: Number.isFinite(at) ? at : Date.now(), version: draft.version }
}

const isStatus = (caught: unknown, status: number) => caught instanceof ApiError && caught.status === status

export interface ScenarioDraftOptions<T> {
  /** 下書きを置くアカウント。決まらない（null）間は何もしない。 */
  accountId: string | null | undefined
  /** 下書きのキー。読み込みが済むまでは null（比べる元が無いので出さない）。 */
  draftKey: string | null
  /** 本物のシナリオに紐づける（そのアカウントのシナリオのときだけ渡す）。 */
  scenarioId?: string | null
  /** 本物の通に紐づける（scenarioId と一緒に渡す）。 */
  stepId?: string | null
  /** 以前このブラウザに残した書きかけのキー（一度だけ移す）。 */
  legacyKey?: string | null
  /** いまの入力。 */
  value: T
  /** 保存済み（本物）の形。これと同じなら下書きは要らない。 */
  baseline: T
  /** 閲覧のみは false。 */
  active?: boolean
}

export function useScenarioDraft<T>({
  accountId,
  draftKey,
  scenarioId = null,
  stepId = null,
  legacyKey = null,
  value,
  baseline,
  active = true,
}: ScenarioDraftOptions<T>) {
  const valueJson = JSON.stringify(value)
  const baselineJson = JSON.stringify(baseline)
  const dirty = valueJson !== baselineJson
  const account = accountId || null
  const token = active && account && draftKey ? `${account}\n${draftKey}` : null

  /** いまサーバーにある下書きの版（無ければ 0）。 */
  const versionRef = useRef<string | 0>(0)
  /** いまサーバーにある下書きの中身（無ければ null）。 */
  const [savedJson, setSavedJson] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [readyToken, setReadyToken] = useState<string | null>(null)
  const [pending, setPending] = useState<{ value: T; savedAt: number } | null>(null)
  const [conflict, setConflict] = useState<Remote<T> | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const baselineRef = useRef(baselineJson)
  baselineRef.current = baselineJson
  const linkRef = useRef({ scenarioId, stepId })
  linkRef.current = { scenarioId, stepId }
  const targetRef = useRef<{ account: string; key: string } | null>(null)
  targetRef.current = account && draftKey ? { account, key: draftKey } : null

  const link = () => {
    const { scenarioId: sid, stepId: tid } = linkRef.current
    return sid ? { scenarioId: sid, stepId: tid ?? null } : {}
  }

  // キーが決まったとき（読み込み済み）に一度だけ、残っている下書きを確かめる。
  useEffect(() => {
    versionRef.current = 0
    setSavedJson(null)
    setSavedAt(null)
    setPending(null)
    setConflict(null)
    setReadyToken(null)
    if (!token || !account || !draftKey) return
    let cancelled = false
    void (async () => {
      let remote: Remote<T> | null = null
      try {
        const res = await api.scenarioDrafts.get(account, draftKey)
        if (res.success) {
          versionRef.current = res.data.version
          remote = toRemote<T>(res.data)
        }
      } catch {
        // 404 は「無い」。ほかの失敗も「無い」として進め、保存の 409 で読み直す。
      }
      if (cancelled) return
      if (remote) setSavedJson(JSON.stringify(remote.value))
      let chosen: { value: T; savedAt: number } | null = remote

      const legacy = legacyKey ? readBrowserDraft<T>(legacyKey) : null
      if (legacy && legacyKey) {
        if (remote && remote.savedAt >= legacy.savedAt) {
          // サーバーのほうが新しい。ブラウザの古い書きかけは消すだけ。
          removeBrowserDraft(legacyKey)
        } else if (JSON.stringify(legacy.value) === baselineRef.current) {
          removeBrowserDraft(legacyKey)
        } else {
          // 一度だけサーバーへ移す。移せなければ残し、次に開いたときにもう一度。
          try {
            const res = await api.scenarioDrafts.save(account, draftKey, {
              expectedVersion: versionRef.current,
              content: { value: legacy.value as unknown },
              ...link(),
            })
            if (cancelled) return
            if (res.success) {
              versionRef.current = res.data.version
              setSavedJson(JSON.stringify(legacy.value))
              removeBrowserDraft(legacyKey)
            }
          } catch {
            /* 次に開いたときにもう一度移す */
          }
          if (cancelled) return
          chosen = { value: legacy.value, savedAt: legacy.savedAt }
        }
      }

      if (chosen && JSON.stringify(chosen.value) === baselineRef.current) {
        // 保存済みと同じなら戻すものは無い。下書きは消す。
        const version = versionRef.current
        versionRef.current = 0
        setSavedJson(null)
        if (version) void api.scenarioDrafts.delete(account, draftKey, version).catch(() => {})
        chosen = null
      }
      setPending(chosen)
      setReadyToken(token)
    })()
    return () => { cancelled = true }
    // link と legacyKey はキーと一緒に決まる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const ready = token !== null && readyToken === token
  /** 下書きがいまの入力と違う（送る必要がある）か。保存済みの形に戻ったら「消す」必要があるか。 */
  const draftDirty = ready && (dirty ? savedJson !== valueJson : savedJson !== null)

  const save = useCallback(async (): Promise<boolean> => {
    const target = targetRef.current
    if (!target) return false
    const sendingJson = valueJson
    if (sendingJson === baselineRef.current) {
      // 保存済みの形に戻った。下書きを消す。
      const version = versionRef.current
      if (!version) {
        setSavedJson(null)
        return true
      }
      try {
        await api.scenarioDrafts.delete(target.account, target.key, version)
      } catch (caught) {
        if (!isStatus(caught, 404) && !isStatus(caught, 409)) return false
      }
      versionRef.current = 0
      setSavedJson(null)
      setSavedAt(null)
      return true
    }
    const put = (expectedVersion: string | 0) => api.scenarioDrafts.save(target.account, target.key, {
      expectedVersion,
      content: { value: JSON.parse(sendingJson) as unknown },
      ...link(),
    })
    const accept = (draft: ScenarioDraft) => {
      versionRef.current = draft.version
      setSavedJson(sendingJson)
      const at = Date.now()
      setSavedAt(at)
      setNow(at)
    }
    try {
      const res = await put(versionRef.current)
      if (!res.success) return false
      accept(res.data)
      return true
    } catch (caught) {
      if (!isStatus(caught, 409)) return false
    }
    // 409：最新を1回読む。消えていたら新しく作り直す。残っていれば競合の帯（上書きしない）。
    try {
      const latest = await api.scenarioDrafts.get(target.account, target.key)
      if (latest.success) {
        const remote = toRemote<T>(latest.data)
        versionRef.current = latest.data.version
        if (remote) setConflict(remote)
        return false
      }
    } catch (caught) {
      if (!isStatus(caught, 404)) return false
    }
    try {
      versionRef.current = 0
      const res = await put(0)
      if (!res.success) return false
      accept(res.data)
      return true
    } catch {
      return false
    }
  }, [valueJson])

  const autosave = useDraftAutosave({
    fingerprint: valueJson,
    dirty: draftDirty,
    active: active && Boolean(account),
    enabled: ready && pending === null && conflict === null,
    save,
  })

  useEffect(() => {
    if (savedAt === null && pending === null && conflict === null) return
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [savedAt, pending, conflict])

  /** 「前の入力を戻す」。戻した値を返す（画面が自分の state へ入れる）。 */
  const restore = useCallback((): T | null => {
    const stored = pending
    setPending(null)
    if (stored) {
      setSavedAt(stored.savedAt)
      setNow(Date.now())
    }
    return stored ? stored.value : null
  }, [pending])

  /** 「捨てる」・本物を保存できた・キャンセル。下書きを消す。 */
  const clear = useCallback(() => {
    setPending(null)
    setConflict(null)
    setSavedAt(null)
    setSavedJson(null)
    const version = versionRef.current
    versionRef.current = 0
    const target = targetRef.current
    if (active && target && version) {
      void api.scenarioDrafts.delete(target.account, target.key, version).catch(() => {})
    }
    if (legacyKey) removeBrowserDraft(legacyKey)
  }, [active, legacyKey])

  /** 競合の帯「最新の下書きを読み込む」。最新の値を返す（画面が自分の state へ入れる）。 */
  const loadLatest = useCallback((): T | null => {
    const latest = conflict
    if (!latest) return null
    setConflict(null)
    versionRef.current = latest.version
    setSavedJson(JSON.stringify(latest.value))
    setSavedAt(latest.savedAt)
    return latest.value
  }, [conflict])

  /** 競合の帯「自分の入力で上書きする」。最新の版を受け取ったうえで、いまの入力を送り直す。 */
  const overwrite = useCallback(() => {
    if (!conflict) return
    versionRef.current = conflict.version
    setConflict(null)
    autosave.retry()
  }, [conflict, autosave])

  let label: string | null = null
  if (active && !account && dirty) label = AUTOSAVE_WORDS.unsaved
  if (active && account) {
    if (autosave.autosaving) label = AUTOSAVE_WORDS.saving
    else if (!dirty) label = null
    else if (draftDirty && autosave.failed && conflict === null) label = SCENARIO_DRAFT_WORDS.failed
    else if (draftDirty || !ready) label = AUTOSAVE_WORDS.unsaved
    else if (savedAt !== null) label = AUTOSAVE_WORDS.saved(savedAgoLabel(savedAt, now))
    else label = AUTOSAVE_WORDS.unsaved
  }

  return {
    dirty,
    pending: active ? pending : null,
    pendingAgo: active && pending ? savedAgoLabel(pending.savedAt, now) : null,
    conflictAgo: active && conflict ? savedAgoLabel(conflict.savedAt, now) : null,
    restore,
    clear,
    loadLatest,
    overwrite,
    label,
  }
}
