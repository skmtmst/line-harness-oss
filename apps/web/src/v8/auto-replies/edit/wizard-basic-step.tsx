'use client'

import Button from '@/components/shared/button';
import Card,{ CardHeader } from '@/components/shared/card';
import FolderSelect,{ folderById,folderCreator } from '@/components/shared/folder-select';
import { Field } from '@/components/shared/form-controls';
import Notice from '@/components/shared/notice';
import { SaveErrorField } from '@/components/shared/save-form-errors';
import { SettingsFormRow } from '@/components/shared/settings-form-card';
import { TextField } from '@/components/shared/text-field';
import { CreateStarterCards } from '@/components/templates/create-parts';
import { api } from '@/lib/api';
import type { Dispatch,SetStateAction } from 'react';
import { STARTER_TEMPLATES,WizardForm,WizardStep } from './wizard-model';
import styles from '../../../app/auto-replies/edit/wizard-v8.module.css';

type WizardBasicStepContext = {
  accountId: string | null
  canManage: boolean
  folders: { id: string; name: string; color?: string | null; }[]
  form: WizardForm
  goToStep: (next: WizardStep, ruleId?: string) => void
  patch: (part: Partial<WizardForm>) => void
  setFolders: Dispatch<SetStateAction<{ id: string; name: string; color?: string | null; }[]>>
  setForm: Dispatch<SetStateAction<WizardForm>>
}

export function WizardBasicStep({ accountId, canManage, folders, form, goToStep, patch, setFolders, setForm }: WizardBasicStepContext) {
  return (<>
              <Card variant="form" gap="normal" className={styles.cardContent}>
                <CardHeader size="stacked" title={<>名前とフォルダ</>} meta={<>一覧に出る名前です。友だちには見えません。</>} />
                <SettingsFormRow layout="name-folder">
                  <div className={styles.field}><Field label="ルール名" htmlFor="wiz-name" required><SaveErrorField names={["ruleName","form.ruleName","rule_name","name","form.rule_name"]}><TextField
                      id="wiz-name"
                      value={form.ruleName}
                      onChange={(e) => patch({ ruleName: e.target.value })}
                      placeholder="例：予約の日程変更"
                    /></SaveErrorField></Field></div>
                  <div className={styles.field}><Field label="フォルダ" htmlFor="wiz-folder"><SaveErrorField names={["folderId","form.folderId","folder_id","form.folder_id"]}><FolderSelect
                      id="wiz-folder"
                      aria-label="フォルダ"
                      size="full"
                      value={form.folderId}
                      onChange={(value) => patch({ folderId: value })}
                      unfiled={{ value: '', label: '分けない' }}
                      folders={folders.map(folderById)}
                      // 一覧の左の列の「フォルダを追加」と同じ口（自動応答と同じアカウントのフォルダ）。
                      onCreate={canManage
                        ? folderCreator((name, color) => api.folders.create({ kind: 'auto_reply', name, color, accountId }), folderById, (created) => setFolders((current) => [...current, { id: created.id, name: created.name, color: created.color }]))
                        : undefined}
                    /></SaveErrorField></Field></div>
                </SettingsFormRow>
                <div className={styles.field}><Field label="社内メモ" htmlFor="wiz-memo"><SaveErrorField names={["internalMemo","form.internalMemo","internal_memo","form.internal_memo"]}><TextField
                    id="wiz-memo"
                    value={form.internalMemo}
                    onChange={(e) => patch({ internalMemo: e.target.value })}
                    placeholder="例：キャンペーン中だけ使う"
                  /></SaveErrorField></Field></div>
              </Card>

              <Notice tone="info">
                新しく作るルールは、一覧のいちばん下（最後に見る順番）に足されます。順番は手順4「優先順位」で確かめます。
              </Notice>

              <Card variant="form" gap="normal" className={`${styles.cardContent} ${styles.starterSection}`}>
                <CardHeader size="stacked" title="ひな形から作る" optional meta={<>選ぶと、条件と返信がまとめて入ります。あとから全部変えられます。</>} />
                <CreateStarterCards
                  items={STARTER_TEMPLATES.map((tpl) => ({
                    key: tpl.key,
                    name: tpl.name,
                    lines: tpl.lines,
                    onUse: () => {
                      setForm((current) => tpl.apply(current))
                      goToStep('trigger')
                    },
                  }))}
                  manage={<Button href="/templates">ひな形を管理</Button>}
                />
              </Card>
            </>)
}
