'use client'

/*
 * ★V8-B 外部連携の API 接続（板 `ralAc`）。
 *
 * v7 の鍵タブ（`api-tokens-panel.tsx` の ApiTokensPanel）とは別の部品として
 * 持つ。データの口（一覧・発行・入れ替え・停止・本人確認）は同じ。違いは
 * 置き場と見せ方——表は「名前・できること・作った日・最後に使った・状態・
 * 操作（入れ替える＋…）」。
 * v7 を直す必要が出たら向こうも同じ判断を入れる（V8 完成までの二重管理）。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - 状態の「止めている」：止めた鍵は一覧に出ないので、一覧の行は
 *   「使っている」だけ出す。
 * - 行の「…」の中身：止めるだけ出す。名前を変える・できることを変えるは
 *   変える口が無いので足さない。
 * - 失効・ローテーションの確認：入れ替え確認の文と発行直後の1回表示で
 *   見せる（`ralAc` の指摘どおり維持する）。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type IntegrationApiTokenInfo } from '@/lib/api'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import NoPermissionV8 from '@/app/no-permission/no-permission-v8'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import Notice from '@/components/shared/notice'
import ActionMenu from '@/components/shared/action-menu'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import { usePageTitle } from '@/components/shell/page-chrome'
import { formatDateTime } from '@/lib/format'
import {
  WebhooksV8Band, WebhooksV8Head, outgoingKpiCells, useV8BandData,
} from './outgoing-v8'
import styles from './apitokens-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden' | 'disabled'

const SCOPE_LABELS: Record<string, string> = {
  'tags:read': 'タグを見る',
  'tags:write': 'タグを付ける',
}

function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope
}

export default function ApiTokensV8Page() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ApiTokensV8Inner />
    </Suspense>
  )
}

function ApiTokensV8Inner() {
  usePageTitle('外部連携')
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)

  const [tokens, setTokens] = useState<IntegrationApiTokenInfo[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [scopes, setScopes] = useState<string[]>(['tags:read', 'tags:write'])
  const [creating, setCreating] = useState(false)
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [rotateTarget, setRotateTarget] = useState<IntegrationApiTokenInfo | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<IntegrationApiTokenInfo | null>(null)
  const [mutating, setMutating] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  const band = useV8BandData()

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    const requestAccountId = selectedAccountId
    setActionError('')
    if (!requestAccountId) {
      setTokens([])
      setStatus('ready')
      return
    }
    setStatus('loading')
    setLoadError('')
    try {
      const res = await api.webhooks.apiTokens.list(requestAccountId)
      if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setStatus('error')
        setLoadError(res.error)
        return
      }
      setTokens(res.data)
      setStatus('ready')
    } catch (caught) {
      if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
      if (caught instanceof ApiError && caught.code === 'FEATURE_DISABLED') {
        setTokens([])
        setStatus('disabled')
        return
      }
      if (caught instanceof ApiError && (caught.status === 403 || caught.status === 404)) {
        setTokens([])
        setStatus('forbidden')
        return
      }
      setStatus('error')
      setLoadError(describeApiFailure(caught, '読み込み'))
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setIssued(null)
    setCopied(false)
  }, [selectedAccountId])

  const toggleScope = (scope: string) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))
  }

  const handleCreate = async (stepUpToken?: string) => {
    setActionError('')
    setNameError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('名前を入力してください')
      return
    }
    if (scopes.length === 0) {
      setActionError('できることを1つ以上選んでください')
      return
    }
    setCreating(true)
    try {
      const res = await api.webhooks.apiTokens.create(requestAccountId, { name: trimmed, scopes }, stepUpToken)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setActionError(res.error)
        return
      }
      setIssued({ name: res.data.name, token: res.data.token })
      setCopied(false)
      setName('')
      setShowCreate(false)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.api_token', action: 'API接続の鍵を発行する', retry: (token) => handleCreate(token) })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setActionError(describeApiFailure(caught, '発行', {
        forbidden: '鍵の発行は統括だけができます。必要なときは統括に頼んでください。',
      }))
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setCreating(false)
    }
  }

  const handleRotate = async (stepUpToken?: string) => {
    setDialogError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId || !rotateTarget) return
    setMutating(true)
    try {
      const res = await api.webhooks.apiTokens.rotate(rotateTarget.id, requestAccountId, stepUpToken)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setDialogError(res.error)
        return
      }
      setIssued({ name: res.data.name, token: res.data.token })
      setCopied(false)
      setRotateTarget(null)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        const target = rotateTarget
        setStepUp({
          purpose: 'webhook.api_token',
          action: `「${target?.name ?? ''}」の鍵を入れ替える`,
          retry: (token) => handleRotate(token),
        })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (caught instanceof ApiError && caught.code === 'TOKEN_ROTATE_CONFLICT') {
        setRotateTarget(null)
        setActionError('ほかの操作が先にこの鍵を更新しました。一覧を読み直しました。最新の状態からもう一度お試しください')
        await load()
        return
      }
      setDialogError(describeApiFailure(caught, '入れ替え', {
        forbidden: '鍵の入れ替えは統括だけができます。必要なときは統括に頼んでください。',
      }))
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setMutating(false)
    }
  }

  const handleRevoke = async (stepUpToken?: string) => {
    setDialogError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId || !revokeTarget) return
    setMutating(true)
    try {
      const res = await api.webhooks.apiTokens.revoke(revokeTarget.id, requestAccountId, stepUpToken)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setDialogError(res.error)
        return
      }
      setRevokeTarget(null)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        const target = revokeTarget
        setStepUp({
          purpose: 'webhook.api_token',
          action: `「${target?.name ?? ''}」の鍵を止める`,
          retry: (token) => handleRevoke(token),
        })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setDialogError(describeApiFailure(caught, '停止', {
        forbidden: '鍵の停止は統括だけができます。必要なときは統括に頼んでください。',
      }))
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setMutating(false)
    }
  }

  const copyIssued = async () => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopied(true)
    } catch {
      // 手で選んで写せるので、失敗しても文は出さない。
    }
  }

  return (
    <div className={styles.board} data-design-node="ralAc">
      <WebhooksV8Head
        activeTab="api-tokens"
        outgoingCount={band.outgoingItems === null ? null : band.outgoingItems.length}
        incomingCount={band.incomingCount}
      />
      <WebhooksV8Band cells={outgoingKpiCells({ items: band.outgoingItems, incomingCount: band.incomingCount, summary: band.summary })} />

      {actionError ? <Notice tone="error">{actionError}</Notice> : null}

      {issued ? (
        <section className={styles.issuedBox} aria-label="発行した鍵">
          <h2 className={styles.issuedTitle}>鍵を発行しました</h2>
          <p className={styles.issuedNote}>この鍵は今だけ表示されます。写したらこの画面を閉じてください。一覧には二度と出ません。</p>
          <p className={styles.issuedToken}>{issued.token}</p>
          <div className={styles.buttonRow} style={{ marginTop: 12 }}>
            <Button variant="secondary" onClick={() => void copyIssued()}>
              {copied ? '写しました' : '鍵を写す'}
            </Button>
            <Button variant="secondary" onClick={() => setIssued(null)}>
              閉じる
            </Button>
          </div>
        </section>
      ) : null}

      <div className={styles.main}>
        <div className={styles.createRow}>
          <Button variant="primary" onClick={() => setShowCreate((open) => !open)}>＋ API接続の鍵を発行する</Button>
          <p className={styles.createNote}>鍵の発行・入れ替え・停止は統括だけができます</p>
        </div>

        <Notice tone="info">
          鍵は発行したときに1回だけ表示されます。外の仕組みに書き写してから閉じてください。入れ替えると、今の鍵はすぐ使えなくなります。
        </Notice>

        {showCreate ? (
          <section className={styles.createBox} aria-label="鍵の発行">
            <h2 className={styles.createTitle}>新しい鍵</h2>
            <div>
              <label className={styles.label} htmlFor="webhook-v8-token-name">名前</label>
              <input
                id="webhook-v8-token-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="例：予約システム連携"
                className={styles.input}
              />
              {nameError ? <p className={styles.fieldError} role="alert">{nameError}</p> : null}
            </div>
            <fieldset>
              <legend className={styles.label}>できること</legend>
              <div className={styles.checkRow}>
                {['tags:read', 'tags:write'].map((scope) => (
                  <Checkbox key={scope} checked={scopes.includes(scope)} onCheckedChange={() => toggleScope(scope)}>
                    {scopeLabel(scope)}
                  </Checkbox>
                ))}
              </div>
            </fieldset>
            <div className={styles.buttonRow}>
              <Button variant="primary" disabled={creating} onClick={() => void handleCreate()} busy={creating} busyLabel="発行しています…">
                発行する
              </Button>
              <Button
                onClick={() => {
                  if (creating) return
                  setShowCreate(false)
                  setName('')
                  setNameError('')
                }}
              >
                キャンセル
              </Button>
            </div>
          </section>
        ) : null}

        {status === 'loading' ? (
          <div aria-busy="true" aria-label="鍵を読み込んでいます">
            <DelayedSkeleton
              loading
              skeleton={(
                <div aria-hidden="true">
                  <div style={{ display: 'flex', gap: 24, padding: '12px 16px' }}>
                    <Skeleton height={12} width={50} />
                    <Skeleton height={12} width={80} />
                    <Skeleton height={12} width={70} />
                    <Skeleton height={12} width={90} />
                    <Skeleton height={12} width={40} />
                    <Skeleton height={12} width={40} />
                  </div>
                  {[0, 1, 2, 3].map((row) => (
                    <div key={row} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderTop: '1px solid var(--color-hairline)' }}>
                      <Skeleton height={14} width={120} />
                      <Skeleton height={14} width={140} />
                      <Skeleton height={14} width={90} />
                      <Skeleton height={14} width={110} />
                      <Skeleton height={20} width={70} />
                      <Skeleton height={30} width={80} />
                    </div>
                  ))}
                </div>
              )}
            />
          </div>
        ) : null}
        {status === 'error' ? (
          <ListState
            kind="error"
            title="鍵を読み込めませんでした"
            description={loadError}
            action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
          />
        ) : null}
        {status === 'forbidden' ? (
          <NoPermissionV8
            featureName="API接続の鍵"
            requiredRoleLabel="統括"
            capabilitiesHref="/staff"
          />
        ) : null}
        {status === 'disabled' ? (
          <ListState
            kind="empty"
            title="外部連携が止まっています"
            description="鍵の一覧は、外部連携を入れ直すと開けます。止めている間も、外から届く鍵の操作は止まっています。"
          />
        ) : null}
        {status === 'ready' ? (
          tokens.length === 0 ? (
            <ListState
              kind="empty"
              title="まだ接続がありません"
              description="「API接続の鍵を発行する」から最初の鍵を発行してください。"
            />
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">名前</th>
                      <th scope="col">できること</th>
                      <th scope="col">作った日</th>
                      <th scope="col">最後に使った</th>
                      <th scope="col">状態</th>
                      <th scope="col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((token) => (
                      <tr key={token.id}>
                        <td className={styles.nameCell} title={token.name}>{token.name}</td>
                        <td><span className={styles.nameCell} title={token.scopes.map(scopeLabel).join('・')}>{token.scopes.map(scopeLabel).join('・')}</span></td>
                        <td className={styles.dimCell}>{formatDateTime(token.createdAt)}</td>
                        <td className={styles.dimCell}>{formatDateTime(token.lastUsedAt)}</td>
                        <td><span className={`${styles.pill} ${styles.pillActive}`}>● 使っている</span></td>
                        <td className={styles.opsCell}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Button
                              onClick={() => {
                                setDialogError('')
                                setRotateTarget(token)
                              }}
                            >
                              入れ替える
                            </Button>
                            <Button
                              aria-haspopup="menu"
                              aria-expanded={menuId === token.id}
                              onClick={() => setMenuId(menuId === token.id ? null : token.id)}
                            >
                              …
                            </Button>
                            <ActionMenu
                              open={menuId === token.id}
                              onClose={() => setMenuId(null)}
                              ariaLabel={`「${token.name}」の操作`}
                              items={[{
                                id: 'revoke',
                                label: '止める',
                                tone: 'danger',
                                onSelect: () => {
                                  setMenuId(null)
                                  setDialogError('')
                                  setRevokeTarget(token)
                                },
                              }]}
                            />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.footNote}>行の「…」から 止める。止めても、すでに付けたタグは残ります。</p>
            </>
          )
        ) : null}
      </div>

      <ConfirmDialog
        open={rotateTarget !== null}
        title={`「${rotateTarget?.name ?? ''}」の鍵を入れ替えますか？`}
        description="今の鍵はすぐ使えなくなり、新しい鍵が1回だけ表示されます。外の仕組みの鍵を新しいものに書き換えるまで、つなぎ先の操作は止まります。"
        confirmLabel="入れ替える"
        busy={mutating}
        error={dialogError}
        onConfirm={() => void handleRotate()}
        onCancel={() => {
          if (mutating) return
          setRotateTarget(null)
          setDialogError('')
        }}
      />
      <ConfirmDialog
        open={revokeTarget !== null}
        title={`「${revokeTarget?.name ?? ''}」の鍵を止めますか？`}
        description="この鍵での外からの操作はすぐ止まります。すでに付けたタグは残ります。この操作は取り消せません。"
        confirmLabel="止める"
        destructive
        busy={mutating}
        error={dialogError}
        onConfirm={() => void handleRevoke()}
        onCancel={() => {
          if (mutating) return
          setRevokeTarget(null)
          setDialogError('')
        }}
      />
      {stepUp ? <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} /> : null}
    </div>
  )
}
