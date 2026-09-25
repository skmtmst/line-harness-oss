'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type FileScanConfig, type FileScanItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SelectField from '@/components/shared/select-field'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { TextField, TextArea } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'

/**
 * 設定の中の「ファイルの検査」（B-2）。
 *
 * しまったファイルの一覧・消す・誤りなので戻す（理由を記録）は
 * owner / admin だけ。それ以外は入れない。
 */

type Phase = 'loading' | 'ready' | 'error' | 'forbidden'

export default function FileScanSettingsPage() {
  usePageTitle('ファイルの検査')
  const { selectedAccountId } = useAccount()
  const [phase, setPhase] = useState<Phase>('loading')
  const [items, setItems] = useState<FileScanItem[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('quarantined')
  const [actionError, setActionError] = useState('')
  const [actionDone, setActionDone] = useState('')
  const [releaseTarget, setReleaseTarget] = useState<FileScanItem | null>(null)
  const [releaseReason, setReleaseReason] = useState('')
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FileScanItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [config, setConfig] = useState<FileScanConfig | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [provider, setProvider] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [configBusy, setConfigBusy] = useState(false)

  // 外の検査の設定が保存前なら離脱の番兵を出す。
  const configDirty = configOpen && (
    (provider.trim() || null) !== (config?.externalProvider ?? null)
    || (endpoint.trim() || null) !== (config?.externalEndpointUrl ?? null)
    || (secretRef.trim() || null) !== (config?.externalSecretRef ?? null)
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: configDirty, busy: configBusy })

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setPhase('ready')
      setItems([])
      setTotal(0)
      return
    }
    setPhase('loading')
    setActionError('')
    try {
      const [me, list, configRes] = await Promise.all([
        api.staff.me(),
        api.fileScan.list(selectedAccountId, { status: statusFilter, limit: 50, offset: 0 }),
        api.fileScan.getConfig(selectedAccountId),
      ])
      if (!me.success || !list.success || !configRes.success) {
        setPhase('error')
        return
      }
      if (me.data.role !== 'owner' && me.data.role !== 'admin') {
        setPhase('forbidden')
        return
      }
      setItems(list.data.items)
      setTotal(list.data.total)
      setConfig(configRes.data.config)
      setProvider(configRes.data.config?.externalProvider ?? '')
      setEndpoint(configRes.data.config?.externalEndpointUrl ?? '')
      setSecretRef(configRes.data.config?.externalSecretRef ?? '')
      setPhase('ready')
    } catch {
      setPhase('error')
    }
  }, [selectedAccountId, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  async function release() {
    if (!selectedAccountId || !releaseTarget || !releaseReason.trim()) return
    setReleaseBusy(true)
    setActionError('')
    try {
      const res = await api.fileScan.release(releaseTarget.id, selectedAccountId, releaseReason.trim())
      if (!res.success) {
        setActionError('戻せませんでした。通信状態を確認して、もう一度お試しください。')
        return
      }
      setReleaseTarget(null)
      setReleaseReason('')
      setActionDone(`${releaseTarget.filename} を使えるように戻しました。`)
      await load()
    } catch (caught) {
      setActionError(caught instanceof ApiError && caught.status === 409
        ? 'しまったファイルだけ戻せます。一覧を読み直してください。'
        : '戻せませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setReleaseBusy(false)
    }
  }

  async function remove() {
    if (!selectedAccountId || !deleteTarget) return
    setDeleteBusy(true)
    setActionError('')
    try {
      const res = await api.fileScan.remove(deleteTarget.id, selectedAccountId)
      if (!res.success) {
        setActionError('消せませんでした。通信状態を確認して、もう一度お試しください。')
        return
      }
      setDeleteTarget(null)
      setActionDone(`${deleteTarget.filename} を消しました。`)
      await load()
    } catch (caught) {
      setActionError(caught instanceof ApiError && caught.status === 409
        ? 'しまった・使えないファイルだけ消せます。一覧を読み直してください。'
        : '消せませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function saveConfig() {
    if (!selectedAccountId) return
    setConfigBusy(true)
    setActionError('')
    try {
      const res = await api.fileScan.saveConfig(selectedAccountId, {
        externalProvider: provider.trim() || null,
        externalEndpointUrl: endpoint.trim() || null,
        externalSecretRef: secretRef.trim() || null,
      })
      if (!res.success) {
        setActionError('設定を保存できませんでした。')
        return
      }
      setConfigOpen(false)
      setActionDone('外の検査の設定を保存しました。')
      await load()
    } catch (caught) {
      setActionError(caught instanceof ApiError && caught.status === 400
        ? '宛先は https にし、提供元と宛先の両方を入れてください。'
        : '設定を保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setConfigBusy(false)
    }
  }

  if (phase === 'loading') {
    return <ListState kind="loading" />
  }

  if (phase === 'error') {
    return (
      <ListState
        kind="error"
        title="ファイルの検査を読み込めませんでした"
        description="通信状態を確認して、もう一度読み込んでください。"
        onRetry={() => void load()}
      />
    )
  }

  if (phase === 'forbidden') {
    return (
      <ListState
        kind="forbidden"
        title="ファイルの検査は管理者だけが開けます"
        description="しまったファイルの確認は、owner・admin の操作です。変えたいときは管理者に頼んでください。"
      />
    )
  }

  if (!selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントを選んでください"
        description="ファイルの検査はLINEアカウントごとに管理します。"
      />
    )
  }

  return (
    <div>
      <NoteBar>確かめ終わるまで、上げたファイルは配信・公開・審査に出ません。</NoteBar>

      {actionError ? <p role="alert" className="bg-danger-bg text-danger mt-4 rounded-control p-3 text-xs">{actionError}</p> : null}
      {actionDone ? <p role="status" className="bg-accent-soft text-accent-deep mt-4 rounded-control p-3 text-xs">{actionDone}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h2 className="text-ink text-base font-bold">
          しまったファイル
          <HelpTip label="しまったファイルの意味">
            危険な中身が見つかったため、どこにも出さないようにしたファイルです。中身は画面に出ません。
          </HelpTip>
        </h2>
        <Chip tone="warn">{`${total}件`}</Chip>
        <span className="ml-auto">
          <SelectField
            aria-label="検査の状態"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            options={[
              { value: 'quarantined', label: '状態：しまったもの' },
              { value: 'pending', label: '状態：確かめています' },
              { value: 'rejected', label: '状態：使えません' },
              { value: 'clean', label: '状態：使えます' },
            ]}
          />
        </span>
      </div>

      {items.length === 0 ? (
        <div className="mt-4">
          <ListState
            kind="empty"
            title="当てはまるファイルがありません"
            description="状態の絞り込みを変えてください。"
          />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <DataTable>
            <colgroup>
              <col style={{ width: '34%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '16%' }} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th>ファイル</Th>
                <Th>上げた人</Th>
                <Th>見つかったもの</Th>
                <Th>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <span className="block truncate" title={item.filename}>{item.filename}</span>
                  </Td>
                  <Td>
                    <span className="block truncate" title={item.uploaderLabel ?? '—'}>{item.uploaderLabel ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="block truncate" title={item.reasonLabel ?? '確認が必要です'}>{item.reasonLabel ?? '確認が必要です'}</span>
                  </Td>
                  <Td>
                    {item.status === 'quarantined' ? (
                      <RowActions
                        subjectName={item.filename}
                        edit={{ label: '使えるように戻す', onClick: () => { setReleaseTarget(item); setReleaseReason('') } }}
                        destructiveItem={{ id: 'delete', label: '消す', onSelect: () => setDeleteTarget(item) }}
                      />
                    ) : item.status === 'rejected' ? (
                      <RowActions
                        subjectName={item.filename}
                        destructiveItem={{ id: 'delete', label: '消す', onSelect: () => setDeleteTarget(item) }}
                      />
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}

      <h2 className="text-ink mt-8 text-base font-bold">外の検査</h2>
      <p className="text-ink-secondary mt-1 text-xs">
        {config?.externalEndpointUrl ? `送り先：${config.externalEndpointUrl}` : 'いまは内蔵の簡易検査だけです。'}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span id="file-scan-external-label" className="text-ink text-sm">外の検査サービスを使う</span>
        <HelpTip label="外の検査サービスの意味">
          内蔵の簡易検査に加えて、外の検査サービスにも送る設定です。設定がある時だけ送ります。鍵そのものはここに置かず、秘密値の仕組みにある名前だけを指します。
        </HelpTip>
        <Toggle
          label="外の検査サービスを使う"
          checked={configOpen}
          onChange={setConfigOpen}
        />
      </div>
      {configOpen ? (
        <div className="mt-3 max-w-xl space-y-3">
          <div>
            <label htmlFor="file-scan-provider" className="text-ink-secondary mb-1 block text-xs font-semibold">提供元</label>
            <TextField
              id="file-scan-provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="例：example-scan"
            />
          </div>
          <div>
            <label htmlFor="file-scan-endpoint" className="text-ink-secondary mb-1 block text-xs font-semibold">送り先（https）</label>
            <TextField
              id="file-scan-endpoint"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://example.com/scan"
            />
          </div>
          <div>
            <label htmlFor="file-scan-secret-ref" className="text-ink-secondary mb-1 block text-xs font-semibold">鍵の名前</label>
            <TextField
              id="file-scan-secret-ref"
              value={secretRef}
              onChange={(event) => setSecretRef(event.target.value)}
              placeholder="例：FILE_SCAN_API_KEY"
            />
          </div>
          <div>
            <Button type="button" variant="primary" disabled={configBusy} onClick={() => void saveConfig()}>
              {configBusy ? '保存しています…' : '外の検査の設定を保存'}
            </Button>
          </div>
        </div>
      ) : null}

      {releaseTarget ? (
        <ConfirmDialog
          open
          title="使えるように戻す"
          description={`${releaseTarget.filename} は誤りだったとして、使えるように戻します。理由は記録に残ります。`}
          confirmLabel="使えるように戻す"
          cancelLabel="やめる"
          busy={releaseBusy}
          onCancel={() => { setReleaseTarget(null); setReleaseReason('') }}
          onConfirm={() => void release()}
        >
          <div>
            <label htmlFor="file-scan-release-reason" className="text-ink-secondary mb-1 block text-xs font-semibold">理由（必須）</label>
            <TextArea
              id="file-scan-release-reason"
              value={releaseReason}
              onChange={(event) => setReleaseReason(event.target.value)}
              placeholder="例：社内の画像と確認できたため"
            />
          </div>
        </ConfirmDialog>
      ) : null}

      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない変更があります"
        description="保存せずに移動すると、外の検査の設定の変更は失われます。"
        confirmLabel="保存せずに移動"
        cancelLabel="編集を続ける"
        destructive
        busy={configBusy}
        onCancel={() => {
          if (!configBusy) cancelLeave()
        }}
        onConfirm={() => {
          confirmLeave()
        }}
      />

      {deleteTarget ? (
        <ConfirmDialog
          open
          title="ファイルを消す"
          description={`${deleteTarget.filename} を消します。中身は画面に出ません。監査の記録は残ります。`}
          confirmLabel="消す"
          cancelLabel="やめる"
          busy={deleteBusy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  )
}
