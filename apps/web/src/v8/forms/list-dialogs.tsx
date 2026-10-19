'use client'

import type { AccountWithStats } from '@/contexts/account-context';


import Button from '@/components/shared/button';
import ConfirmDialog from '@/components/shared/confirm-dialog';
import CopyTextButton from '@/components/shared/copy-text-button';
import DetailPanel from '@/components/shared/detail-panel';
import Dialog,{ DialogActions } from '@/components/shared/dialog';
import FolderAddDialog from '@/components/shared/folder-add-dialog';
import { Field } from '@/components/shared/form-controls';
import InlineEdit from '@/components/shared/inline-edit';
import Notice from '@/components/shared/notice';
import RadioCard,{ RadioCardGroup } from '@/components/shared/radio-card';
import { SaveErrorField } from '@/components/shared/save-form-errors';
import { withViewTransition } from '@/components/shared/view-transition';
import { type FormDeleteImpact } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { displayFormName,type Folder } from '@line-crm/shared';
import { Archive,TriangleAlert } from 'lucide-react';
import type { Dispatch,SetStateAction } from 'react';
import styles from './list.module.css';
import { answerSubText,destinationText,formAnswerCount,formAnswerUrl,referenceLabel,subLineText,UNFILED_VALUE,type Form } from './model';

type RenderFormDialogsContext = {
  active: Form | null
  activeIndex: number
  canEditForms: boolean
  closeDelete: () => void
  closeDetail: () => void
  closeMove: () => void
  closeRename: () => void
  deleteError: string
  deleteImpact: FormDeleteImpact | null
  deleteImpactLoading: boolean
  deleteTarget: Form | null
  deleting: boolean
  deletingFolder: Folder | null
  deletingFolderCount: number | null
  editingFolder: Folder | null
  folderBusy: boolean
  folderDialogOpen: boolean
  folderError: string
  folders: Folder[]
  goDetail: (direction: -1 | 1) => void
  loadForms: () => Promise<void>
  moveBusy: boolean
  moveError: string
  moveFolderId: string
  moveForm: () => Promise<void>
  moveTarget: Form | null
  openDelete: (form: Form) => Promise<void>
  openDuplicate: (form: Form) => void
  openMove: (form: Form) => void
  openStop: (form: Form) => Promise<void>
  removeFolder: () => Promise<void>
  removeForm: (permanentDelete: boolean) => Promise<void>
  renameError: string
  renameForm: (target: Form, next: string) => Promise<void>
  renameName: string
  renameTarget: Form | null
  renaming: boolean
  saveRename: () => Promise<void>
  selectedAccount: AccountWithStats | null
  selectedAccountId: string | null
  setDeletingFolder: Dispatch<SetStateAction<Folder | null>>
  setEditingFolder: Dispatch<SetStateAction<Folder | null>>
  setFolderDialogOpen: Dispatch<SetStateAction<boolean>>
  setFolderError: Dispatch<SetStateAction<string>>
  setMoveFolderId: Dispatch<SetStateAction<string>>
  setRenameName: Dispatch<SetStateAction<string>>
  setStopError: Dispatch<SetStateAction<string>>
  setStopRevision: Dispatch<SetStateAction<number | null>>
  setStopTarget: Dispatch<SetStateAction<Form | null>>
  stopAccepting: () => Promise<void>
  stopError: string
  stopImpactLoading: boolean
  stopping: boolean
  stopRevision: number | null
  stopTarget: Form | null
  visibleForms: Form[]
}

export function renderFormDialogs({ active, activeIndex, canEditForms, closeDelete, closeDetail, closeMove, closeRename, deleteError, deleteImpact, deleteImpactLoading, deleteTarget, deleting, deletingFolder, deletingFolderCount, editingFolder, folderBusy, folderDialogOpen, folderError, folders, goDetail, loadForms, moveBusy, moveError, moveFolderId, moveForm, moveTarget, openDelete, openDuplicate, openMove, openStop, removeFolder, removeForm, renameError, renameForm, renameName, renameTarget, renaming, saveRename, selectedAccount, selectedAccountId, setDeletingFolder, setEditingFolder, setFolderDialogOpen, setFolderError, setMoveFolderId, setRenameName, setStopError, setStopRevision, setStopTarget, stopAccepting, stopError, stopImpactLoading, stopping, stopRevision, stopTarget, visibleForms }: RenderFormDialogsContext) {
  return ((
    <>
      {(folderDialogOpen || editingFolder) && selectedAccountId ? (
        <FolderAddDialog key={editingFolder?.id ?? 'new'} kind="form" accountId={selectedAccountId}
          folder={editingFolder ?? undefined}
          note="フォームを分けてしまう箱です。消しても、中のフォームは未分類に残ります。"
          onClose={() => { setFolderDialogOpen(false); setEditingFolder(null) }}
          onAdded={() => { setEditingFolder(null); void loadForms() }} />
      ) : null}

      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={`削除しても、中のフォームは未分類に残ります。${
          deletingFolderCount === null
            ? 'いまこのフォルダに入っている件数を確認できませんでした。'
            : `いまこのフォルダに入っているのは${formatNumber(deletingFolderCount)} 件です。`
        }`}
        confirmLabel="削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onConfirm={() => removeFolder()}
        onCancel={() => {
          if (folderBusy) return
          setDeletingFolder(null)
          setFolderError('')
        }}
      />

      {moveTarget !== null ? (
        <DetailPanel
          open
          title={`「${displayFormName(moveTarget.name)}」をどのフォルダへ移しますか？`}
          description="回答やURLは変わりません。入れる箱だけが変わります。"
          onClose={() => withViewTransition(closeMove)}
          footer={(
            <div className={styles.panelFooter}>
              <Button type="button" variant="secondary" disabled={moveBusy} onClick={closeMove}>キャンセル</Button>
              <Button type="button" variant="primary" busy={moveBusy} busyLabel="処理中" disabled={moveBusy} onClick={() => void moveForm()}>
                移動する
              </Button>
            </div>
          )}
        >
          {moveError ? <Notice tone="danger" className={styles.alertTextNoticePlacement} >{moveError}</Notice> : null}
          <SaveErrorField names={["move-folder","id","folder.id","moveFolderId"]}><RadioCardGroup legend="移動先のフォルダ" className={styles.radioList}>
            {[{ id: UNFILED_VALUE, name: '未分類' }, ...folders.map((folder) => ({ id: folder.id, name: folder.name }))].map((folder) => (
              <RadioCard
                key={folder.id}
                name="move-folder"
                value={folder.id}
                checked={moveFolderId === folder.id}
                onChange={() => setMoveFolderId(folder.id)}
                title={folder.name}
              />
            ))}
          </RadioCardGroup></SaveErrorField>
        </DetailPanel>
      ) : null}

      <DetailPanel
        open={active !== null}
        title={active ? displayFormName(active.name) : ''}
        description={active ? subLineText(active) : undefined}
        onClose={closeDetail}
        hasPrev={activeIndex > 0}
        hasNext={activeIndex >= 0 && activeIndex < visibleForms.length - 1}
        onPrev={activeIndex > 0 ? () => goDetail(-1) : undefined}
        onNext={activeIndex >= 0 && activeIndex < visibleForms.length - 1 ? () => goDetail(1) : undefined}
        footer={active ? (
          <div className={styles.panelFooterSplit}>
            <Button type="button" variant="secondary" href={`/form-submissions/responses?id=${encodeURIComponent(active.id)}`}>
              集まった回答
            </Button>
            {canEditForms ? <Button type="button" variant="primary" href={`/form-submissions/edit?id=${encodeURIComponent(active.id)}&tab=basic`}>
              編集する
            </Button> : null}
          </div>
        ) : undefined}
      >
        {active ? (
          <div>
            <p className={styles.panelLabel}>フォーム名</p>
            {canEditForms ? <InlineEdit
              value={active.name}
              label="フォーム名"
              placeholder="名称未設定のフォーム"
              onSave={(next) => renameForm(active, next)}
            /> : <p className={styles.panelValue}>{displayFormName(active.name)}</p>}
            <p className={styles.panelLabel}>状態</p>
            <p className={styles.panelValueRow}>
              <span className={styles.statusPill} data-tone={active.isActive ? 'live' : 'draft'}>
                <span className={styles.dot} aria-hidden="true" />
                {active.isActive ? '公開中' : '下書き'}
              </span>
              {(active.pendingPostActionCount ?? 0) > 0 ? (
                <span className={styles.pendingBadge}>
                  <span className={styles.dot} aria-hidden="true" />
                  {`後処理の未完 ${active.pendingPostActionCount}`}
                </span>
              ) : null}
            </p>
            <p className={styles.panelLabel}>保存先</p>
            <p className={styles.panelValue}>{destinationText(active)}</p>
            <p className={styles.panelLabel}>回答</p>
            <p className={styles.panelValue}>
              {`${formatNumber(formAnswerCount(active))} 件　${answerSubText(active)}`}
            </p>
            <div className={styles.panelButtons}>
              {canEditForms ? <>
              <Button type="button" variant="secondary" onClick={() => { closeDetail(); openDuplicate(active) }}>複製</Button>
              {active.isActive ? (
                <Button type="button" variant="secondary" onClick={() => { closeDetail(); return openStop(active) }} busyLabel="処理中…">受付を止める</Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={() => { closeDetail(); openMove(active) }}>フォルダへ移す</Button>
              <Button type="button" variant="secondary" onClick={() => { closeDetail(); return openDelete(active) }} busyLabel="処理中…">アーカイブ・削除</Button>
              </> : null}
              <CopyTextButton value={formAnswerUrl(selectedAccount?.liffId, active.id) ?? ''} aria-label="回答フォームのURLをコピー" disabled={!formAnswerUrl(selectedAccount?.liffId, active.id)} />
            </div>
          </div>
        ) : null}
      </DetailPanel>

      {/* 受付を止める（メニューから直行）。止めると URL を開いた人には「受付を終了しました」が出る。 */}
      <ConfirmDialog
        open={stopTarget !== null}
        title={stopTarget ? `「${displayFormName(stopTarget.name)}」の受付を止めますか？` : '受付を止めますか？'}
        description="配っている URL を開いた人には「受付を終了しました」と出ます。集まった回答と一覧への表示は残ります。"
        confirmLabel="受付を止める"
        destructive
        busy={stopping || stopImpactLoading}
        error={stopError || undefined}
        onConfirm={stopError || stopRevision !== null ? () => stopAccepting() : undefined}
        onCancel={() => {
          if (stopping) return
          setStopTarget(null)
          setStopRevision(null)
          setStopError('')
        }}
      >
        {stopImpactLoading ? <p className={styles.dialogNote}>フォームの状態を確認しています。</p> : null}
      </ConfirmDialog>

      {/*
       * アーカイブ・削除の窓（`GVizd`）。2枚の説明カード（アーカイブ＝おすすめ・削除）と
       * 利用先の注意、下に「削除する｜キャンセル・アーカイブする」。
       * 削除できるのは「未公開・回答なし・利用先なし」のときだけ。
       */}
      <Dialog
        open={deleteTarget !== null}
        designNode="GVizd"
        /* 絵は幅 640・上から 220。 */
        designWidth={640}
        designTop={220}
        title={deleteTarget ? `「${displayFormName(deleteTarget.name)}」をどうしますか` : 'フォームをどうしますか'}
        designHeaderPadding="var(--tpl-fm2-dialog-head-pad)"
        busy={deleting || deleteImpactLoading}
        onCancel={closeDelete}
        footer={(
          <DialogActions leadingAction={
              <Button
                type="button"
                variant="danger"
                disabled={deleting || deleteImpactLoading || !deleteImpact?.canDelete}
                title={deleteImpact && !deleteImpact.canDelete ? '未公開・回答なし・利用先なしのフォームだけ削除できます' : undefined}
                onClick={() => void removeForm(true)} busy={Boolean(deleting)} busyLabel="処理中…"
              >
                削除する
              </Button>
          }>
            <Button type="button" variant="secondary" disabled={deleting || deleteImpactLoading} onClick={closeDelete}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              busy={deleting}
              busyLabel="処理中"
              disabled={deleting || deleteImpactLoading || !deleteImpact?.canArchive}
              onClick={() => void removeForm(false)}
            >
              <Archive size={15} aria-hidden="true" />
              アーカイブする
            </Button>
          </DialogActions>
        )}
      >
        {/* 絵は頭（題と×）・説明・2枚のカード・注意の帯・ボタンを 14 ずつで並べる。共通の窓の中身の余白（上下24）を詰める。 */}
        <div className={styles.archiveBody}>
        {deleteImpact?.form.isActive ? (
          <p className={styles.archiveLead}>配っている URL を開いた人には「受付を終了しました」と出ます。</p>
        ) : null}
        {deleteImpactLoading ? (
          <p className={styles.dialogNote}>公開状態・回答数・利用中の場所を確認しています。</p>
        ) : deleteImpact ? (
          <>
          <div className={styles.impactOptions}>
            <div className={styles.impactOption} data-tone="recommended">
              <p className={styles.impactOptionTitle}>アーカイブする（おすすめ）</p>
              <p className={styles.impactOptionDesc}>
                {`一覧から隠します。集まった回答 ${formatNumber(deleteImpact.submissionCount)} 件 と友だち情報に保存した答えは残ります。`}
              </p>
            </div>
            <div className={styles.impactOption} data-disabled={deleteImpact.canDelete ? undefined : ''}>
              <p className={styles.impactOptionTitle} data-tone="danger">削除する</p>
              <p className={styles.impactOptionDesc}>
                {deleteImpact.canDelete
                  ? '未公開・回答なし・利用先なしのため、完全に削除できます。この操作は元に戻せません。'
                  : '回答や利用先があるので削除できません。削除できるのは、未公開・回答なし・利用先なしのフォームだけです。'}
              </p>
            </div>
          </div>
            {deleteImpact.references.length > 0 ? (
              <p className={styles.impactWarn} title={deleteImpact.answerUrl ? `開けなくなる公開URL：${deleteImpact.answerUrl}` : undefined}>
                <TriangleAlert size={16} aria-hidden="true" />
                <span>{`${deleteImpact.references.map(referenceLabel).join('と')}がこのフォームを開きます。`}</span>
              </p>
            ) : null}
            {/* 利用先の注意があるときは、その札の title に URL を入れる（絵の窓に URL の行は無い）。 */}
            {deleteImpact.answerUrl && deleteImpact.references.length === 0 ? (
              <p className={styles.dialogNote}>
                開けなくなる公開URL：<span className={styles.breakAll}>{deleteImpact.answerUrl}</span>
              </p>
            ) : null}
          </>
        ) : null}
        {deleteError ? <Notice tone="danger" className={styles.alertTextNoticePlacement} >{deleteError}</Notice> : null}
        </div>
      </Dialog>

      {/* 名前を変更。回答データやURLは変わらない。 */}
      <Dialog
        open={renameTarget !== null}
        title="フォーム名を変更"
        description="回答データやURLは変わりませんが、回答者に表示されるフォーム名も変わります。"
        busy={renaming}
        onCancel={closeRename}
        footer={(
          <div className={styles.panelFooter}>
            <Button type="button" variant="secondary" disabled={renaming} onClick={closeRename}>キャンセル</Button>
            <Button
              type="button"
              variant="primary"
              busy={renaming}
              busyLabel="保存中"
              disabled={renaming || !renameName.trim()}
              onClick={() => void saveRename()}
            >
              保存する
            </Button>
          </div>
        )}
      >
        <Field label="フォーム名"><SaveErrorField names={["renameName","rename_name"]}><input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            disabled={renaming}
            maxLength={100}
            className={styles.panelInput}
          /></SaveErrorField></Field>
        {renameError ? <p className={styles.alertText} role="alert">{renameError}</p> : null}
      </Dialog>
    </>
  ))
}
