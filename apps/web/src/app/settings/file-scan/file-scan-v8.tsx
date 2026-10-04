'use client'

import Button from '@/components/shared/button'
import NoPermissionV8 from '@/app/no-permission/no-permission-v8'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { RowActions } from '@/components/shared/row-actions'
import { TextField, TextArea } from '@/components/shared/text-field'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import ListRange from '@/components/ui/list-range'
import { FILE_SCAN_PAGE_SIZE, useFileScan } from './use-file-scan'
import { SettingsShellV8 } from '../settings-nav-v8'
import styles from '../settings-v8.module.css'

const STATUS_OPTIONS = [
  { value: 'quarantined', label: '状態：しまったもの' },
  { value: 'pending', label: '状態：確かめています' },
  { value: 'rejected', label: '状態：使えません' },
  { value: 'clean', label: '状態：使えます' },
]

/**
 * ファイルの検査の V8 画面（★V8-B `PfA4o`）。
 * しまったファイルの一覧・戻す・消す・外の検査の設定。owner / admin だけ。
 */
export function FileScanV8() {
  const {
    selectedAccountId,
    phase,
    items,
    total,
    statusFilter,
    query,
    page,
    setPage,
    actionError,
    actionDone,
    releaseTarget,
    setReleaseTarget,
    releaseReason,
    setReleaseReason,
    releaseBusy,
    releaseError,
    setReleaseError,
    deleteTarget,
    setDeleteTarget,
    deleteBusy,
    deleteError,
    setDeleteError,
    config,
    configOpen,
    provider,
    setProvider,
    endpoint,
    setEndpoint,
    secretRef,
    setSecretRef,
    configBusy,
    stopExternal,
    setStopExternal,
    stopError,
    setStopError,
    leaveTarget,
    confirmLeave,
    cancelLeave,
    load,
    release,
    remove,
    saveConfig,
    stopExternalConfig,
    toggleConfigOpen,
    changeQuery,
    changeStatusFilter,
  } = useFileScan()

  const dialogs = (
    <>
      {releaseTarget ? (
        <ConfirmDialog
          open
          title="使えるように戻す"
          description={`${releaseTarget.filename} は誤りだったとして、使えるように戻します。理由は記録に残ります。`}
          confirmLabel="使えるように戻す"
          cancelLabel="キャンセル"
          busy={releaseBusy}
          error={releaseError || undefined}
          onCancel={() => { setReleaseTarget(null); setReleaseReason(''); setReleaseError('') }}
          onConfirm={() => void release()}
        >
          <div>
            <label htmlFor="file-scan-release-reason" className={styles.reasonHint}>
              理由（必須）
            </label>
            <TextArea
              id="file-scan-release-reason"
              value={releaseReason}
              onChange={(event) => { setReleaseReason(event.target.value); setReleaseError('') }}
              placeholder="例：社内の画像と確認できたため"
            />
          </div>
        </ConfirmDialog>
      ) : null}

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="外の検査の設定の変更"
        busy={configBusy}
        onCancel={() => {
          if (!configBusy) cancelLeave()
        }}
        onConfirm={() => {
          confirmLeave()
        }}
      />

      {stopExternal ? (
        <ConfirmDialog
          open
          title="外の検査を止める"
          description="外の検査サービスへの送信設定を消します。内蔵の簡易検査は続きます。もう一度使うには設定を入れ直します。"
          confirmLabel="外の検査を止める"
          cancelLabel="キャンセル"
          busy={configBusy}
          error={stopError || undefined}
          onCancel={() => { setStopExternal(false); setStopError('') }}
          onConfirm={() => void stopExternalConfig()}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          open
          title="ファイルを削除する"
          description={`${deleteTarget.filename} を消します。中身は画面に出ません。監査の記録は残ります。`}
          confirmLabel="削除する"
          cancelLabel="キャンセル"
          busy={deleteBusy}
          error={deleteError || undefined}
          onCancel={() => { setDeleteTarget(null); setDeleteError('') }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </>
  )

  if (phase === 'loading' || phase === 'error' || phase === 'forbidden' || !selectedAccountId) {
    return (
      <SettingsShellV8
        title="ファイルの検査"
        back={{ href: '/settings', label: '機能設定へ' }}
      >
        {phase === 'loading' ? (
          <ListState kind="loading" />
        ) : phase === 'error' ? (
          <ListState
            kind="error"
            title="ファイルの検査を読み込めませんでした"
            description="通信状態を確認して、もう一度読み込んでください。"
            onRetry={() => void load()}
          />
        ) : phase === 'forbidden' ? (
          <NoPermissionV8
            featureName="ファイルの検査"
            capabilitiesHref="/staff"
            backLabel="機能設定へ戻る"
            backHref="/settings"
          />
        ) : (
          <ListState
            kind="empty"
            title="LINEアカウントを選んでください"
            description="ファイルの検査はLINEアカウントごとに管理します。"
          />
        )}
        {dialogs}
      </SettingsShellV8>
    )
  }

  return (
    <SettingsShellV8
      title="ファイルの検査"
      back={{ href: '/settings', label: '機能設定へ' }}
    >
      <p className={`${styles.band} ${styles.bandInfo}`}>
        上げたファイルは、確かめ終わるまで配信・公開・審査に出ません。
      </p>

      {actionError ? <p role="alert" className={`${styles.band} ${styles.bandDanger}`}>{actionError}</p> : null}
      {actionDone ? <p role="status" className={`${styles.band} ${styles.bandInfo}`}>{actionDone}</p> : null}

      <div className={styles.toolbar}>
        <h2 className={styles.sectionTitle}>
          しまったファイル
          <span className={`${styles.statusChip} ${styles.statusWarn} ${styles.chipInline}`}>{total}件</span>
        </h2>
        <span className={styles.toolbarSearch}>
          <input
            type="search"
            aria-label="ファイル名で探す"
            placeholder="ファイル名で探す"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
        </span>
        <Select
          aria-label="検査の状態"
          value={statusFilter}
          onChange={changeStatusFilter}
          options={STATUS_OPTIONS}
        />
      </div>

      {items.length === 0 ? (
        <ListState
          kind="empty"
          title="当てはまるファイルがありません"
          description="状態の絞り込みを変えてください。"
        />
      ) : (
        <div className={styles.tableCard}>
          <table>
            <colgroup>
              <col style={{ width: '32%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>ファイル</th>
                <th>上げた人</th>
                <th>見つかったもの</th>
                <th className={styles.tdRight}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><span className={styles.urlCell} title={item.filename}>{item.filename}</span></td>
                  <td><span className={styles.urlCell} title={item.uploaderLabel ?? '—'}>{item.uploaderLabel ?? '—'}</span></td>
                  <td><span className={styles.urlCell} title={item.reasonLabel ?? '確認が必要です'}>{item.reasonLabel ?? '確認が必要です'}</span></td>
                  <td className={styles.tdRight}>
                    {item.status === 'quarantined' ? (
                      <RowActions
                        subjectName={item.filename}
                        edit={{ label: '使えるように戻す', onClick: () => { setReleaseTarget(item); setReleaseReason(''); setReleaseError('') } }}
                        destructiveItem={{ id: 'delete', label: '削除する', onSelect: () => { setDeleteTarget(item); setDeleteError('') } }}
                      />
                    ) : item.status === 'rejected' ? (
                      <RowActions
                        subjectName={item.filename}
                        destructiveItem={{ id: 'delete', label: '削除する', onSelect: () => { setDeleteTarget(item); setDeleteError('') } }}
                      />
                    ) : (
                      <span className={styles.cardMeta}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > FILE_SCAN_PAGE_SIZE ? (
        <div className={styles.toolbar}>
          <ListRange
            total={total}
            first={(page - 1) * FILE_SCAN_PAGE_SIZE + 1}
            last={Math.min(page * FILE_SCAN_PAGE_SIZE, total)}
          />
          <Pagination
            page={page}
            pageCount={Math.ceil(total / FILE_SCAN_PAGE_SIZE)}
            onPageChange={setPage}
          />
        </div>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>外の検査</h2>
        </div>
        <div className={`${styles.row} ${styles.blockRow}`}>
          <p className={styles.rowNote}>
            {config?.externalProvider && config?.externalEndpointUrl
              ? `使っています。送り先：${config.externalEndpointUrl}`
              : 'いまは内蔵の簡易検査だけです。外の検査サービスには送っていません。'}
          </p>
          <div className={`${styles.toolbar} ${styles.actionsGap}`}>
            <Button variant="secondary" type="button" onClick={toggleConfigOpen}>
              {configOpen ? '設定を閉じる' : '設定を編集'}
            </Button>
            {config?.externalProvider && config?.externalEndpointUrl ? (
              <Button variant="secondary" type="button" disabled={configBusy} onClick={() => { setStopExternal(true); setStopError('') }}>
                外の検査を止める
              </Button>
            ) : null}
          </div>
          {configOpen ? (
            <div className={styles.formNarrow}>
              <div>
                <label htmlFor="file-scan-provider" className={styles.reasonHint}>提供元</label>
                <TextField
                  id="file-scan-provider"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  placeholder="例：example-scan"
                />
              </div>
              <div className={styles.fieldGap}>
                <label htmlFor="file-scan-endpoint" className={styles.reasonHint}>送り先（https）</label>
                <TextField
                  id="file-scan-endpoint"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://example.com/scan"
                />
              </div>
              <div className={styles.fieldGap}>
                <label htmlFor="file-scan-secret-ref" className={styles.reasonHint}>鍵の名前</label>
                <TextField
                  id="file-scan-secret-ref"
                  value={secretRef}
                  onChange={(event) => setSecretRef(event.target.value)}
                  placeholder="例：FILE_SCAN_API_KEY"
                />
              </div>
              <div className={styles.formSubmit}>
                <Button type="button" variant="primary" disabled={configBusy} onClick={() => void saveConfig()} busy={configBusy} busyLabel="保存しています…">
                  外の検査の設定を保存する
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {dialogs}
    </SettingsShellV8>
  )
}
