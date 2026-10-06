'use client'

/*
 * ★V8-B 外部連携のAPI接続（板 `ralAc`）。
 *
 * v7 の器（`api-tokens-panel.tsx`）とは別の器。データの口・動き・文言は
 * v7 と同じで、見た目だけ V8 の帯・表へ寄せる（色・丸みはトークン）。
 * 鍵の発行・入れ替え・停止は本人確認を挟む（v7 と同じ）。
 * v7 を直す必要が出たら `api-tokens-panel.tsx` 側も同じ判断を入れる。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { api, ApiError, type IntegrationApiTokenInfo } from '@/lib/api'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import { inputClass } from '@/components/shared/form-controls'
import { formatDateTime } from '@/lib/format'
import styles from './webhooks-v8-api-tokens.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden' | 'disabled'

/*
 * 外部連携の「API接続」（R434）。外部システムが公開APIを呼ぶための鍵を、
 * 管理画面から発行・棚卸し・停止できるようにする窓口。
 *
 * 口は前からあり（/api/webhooks/api-tokens）、画面からの呼び出しが無かった。
 * 平文の鍵は発行・再発行の応答に1回だけ乗り、一覧には出ない。
 * 画面に残った平文はアカウントを切り替えたら消す。
 */

const SCOPE_LABELS: Record<string, string> = {
  'tags:read': 'タグを見る',
  'tags:write': 'タグを付ける',
}

function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope
}

export default function WebhooksV8ApiTokens() {
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
  // 発行・再発行の直後に1回だけ見せる平文。閉じるか切り替えたら消える。
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [rotateTarget, setRotateTarget] = useState<IntegrationApiTokenInfo | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<IntegrationApiTokenInfo | null>(null)
  const [mutating, setMutating] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)

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
      // 外部連携を止めている間は一覧の口も止まる。止めている旨を見せる。
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

  // アカウントを切り替えたら、残っていた平文は消す。一覧の再読込では消さない
  // （発行・再発行の直後に一覧を読み直しても、1回だけの表示が保たれる）。
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
      const res = await api.webhooks.apiTokens.create(
        requestAccountId,
        { name: trimmed, scopes },
        stepUpToken,
      )
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
      // 鍵の発行は大事な操作。本人確認を求められたら窓を立てる。
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
      // 同時入れ替えに負けたときは一覧を読み直して今の状態から進める。
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
    <div className={styles.stack}>
      <Notice tone="info">
        外部の仕組みから公開APIを呼ぶための鍵の一覧です。鍵はタグの操作だけに使え、管理画面には入れません。
      </Notice>

      {actionError ? (
        <Notice tone="error">{actionError}</Notice>
      ) : null}

      {issued ? (
        <section className={styles.card} aria-label="発行した鍵">
          <h2 className={styles.cardTitle}>鍵を発行しました</h2>
          <p className={styles.cardLead}>
            この鍵は今だけ表示されます。写したらこの画面を閉じてください。一覧には二度と出ません。
          </p>
          <p className={styles.tokenValue}>
            {issued.token}
          </p>
          <div className={styles.row}>
            <Button variant="secondary" onClick={() => void copyIssued()}>
              {copied ? '写しました' : '鍵を写す'}
            </Button>
            <Button variant="secondary" onClick={() => setIssued(null)}>
              閉じる
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
                {[0, 1, 2].map((row) => (
                  <div key={row} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--color-hairline)' }}>
                    <span style={{ flex: 1 }}><Skeleton height={14} width="50%" /><Skeleton className="mt-1" height={11} width="70%" /></span>
                    <Skeleton height={14} width="7rem" />
                    <Skeleton height={30} width="6rem" />
                  </div>
                ))}
              </div>
            )}
          />
        </div>
      ) : null}
      {status === 'error' ? (
        <ListState kind="error" description={loadError} action={<Button onClick={() => void load()}>鍵の一覧を再読み込み</Button>} />
      ) : null}
      {status === 'forbidden' ? (
        <ListState
          kind="forbidden"
          title="この画面を開く権限がありません"
          description="鍵の棚卸しは統括だけができます。必要なときは統括に頼んでください。"
        />
      ) : null}
      {status === 'disabled' ? (
        <ListState
          kind="empty"
          emptyPreset="readonly"
          title="外部連携が止まっています"
          description="鍵の一覧は、外部連携を入れ直すと開けます。止めている間も、外から届く鍵の操作は止まっています。"
        />
      ) : null}

      {status === 'ready' ? (
        <>
          <div>
            <Button variant="primary" onClick={() => setShowCreate((v) => !v)}>
              ＋ 鍵を発行する
            </Button>
          </div>

          {showCreate ? (
            <section className={styles.card} aria-label="接続の作成">
              <h2 className={styles.cardTitle}>新しい接続</h2>
              <div className={styles.field}>
                <label htmlFor="api-token-name" className={styles.fieldLabel}>
                  接続の名前
                </label>
                <input
                  id="api-token-name"
                  type="text"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：予約システム連携"
                  className={inputClass}
                />
                {nameError ? <p className={styles.fieldError} role="alert">{nameError}</p> : null}
              </div>
              <fieldset className={styles.fieldset}>
                <legend className={styles.fieldLabel}>
                  できること
                  <HelpTip label="できることの説明">
                    鍵に持たせる権限です。見るだけの鍵と、タグを付けられる鍵を分けられます。
                  </HelpTip>
                </legend>
                {['tags:read', 'tags:write'].map((scope) => (
                  <div key={scope} className={styles.checkRow}>
                    <Checkbox
                      checked={scopes.includes(scope)}
                      onCheckedChange={() => toggleScope(scope)}
                    >
                      {scopeLabel(scope)}
                    </Checkbox>
                  </div>
                ))}
              </fieldset>
              <div className={styles.row}>
                <Button variant="secondary" disabled={creating} onClick={() => void handleCreate()} busy={creating} busyLabel="発行しています…">発行する
                </Button>
                <Button
                  variant="secondary"
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

          {tokens.length === 0 ? (
            <ListState
              kind="empty"
              title="まだ接続がありません"
              description="「鍵を発行する」から最初の鍵を発行してください。"
            />
          ) : (
            <div className={styles.tableWrap}>
              <DataTable className={styles.table}>
                <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
                <thead>
                  <TableHeadRow>
                    <Th>名前</Th>
                    <Th help="鍵に持たせた権限です。見るだけの鍵と、タグを付けられる鍵があります。">
                      できること
                    </Th>
                    <Th>最後に使った</Th>
                    <Th>作った日</Th>
                    {/* 板 `ralAc` の状態の札。一覧に出る鍵は使えるものだけ。 */}
                    <Th>状態</Th>
                    <Th><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <Tr key={token.id}>
                      <Td title={token.name}><span className={styles.cellMain}>{token.name}</span></Td>
                      <Td title={token.scopes.map(scopeLabel).join('・')}>
                        {token.scopes.map(scopeLabel).join('・')}
                      </Td>
                      <Td title={formatDateTime(token.lastUsedAt)}>
                        {formatDateTime(token.lastUsedAt)}
                      </Td>
                      <Td title={formatDateTime(token.createdAt)}>
                        {formatDateTime(token.createdAt)}
                      </Td>
                      <Td>
                        <StatusBadge tone="success">使っている</StatusBadge>
                      </Td>
                      <ActionCell>
                        <span className={styles.rowActions}>
                          <Button
                            variant="secondary"
                            size="compact"
                            onClick={() => {
                              setDialogError('')
                              setRotateTarget(token)
                            }}
                          >
                            入れ替える
                          </Button>
                          <Button
                            variant="secondary"
                            size="compact"
                            onClick={() => {
                              setDialogError('')
                              setRevokeTarget(token)
                            }}
                          >
                            止める
                          </Button>
                        </span>
                      </ActionCell>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}
        </>
      ) : null}

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
