// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import TemplateConsole, { resolvedItems } from './template-console'
import type { Preflight } from '@/lib/hq-templates-api'

const calls = vi.hoisted(() => Object.fromEntries(['list','accounts','get','create','update','remove','preflight','distribute','result'].map(key => [key, vi.fn()])))
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag','template','rich_menu','form'], hqTemplatesApi: calls }))
vi.mock('next/navigation', () => ({ usePathname: () => '/hq/templates', useRouter: () => ({ push: vi.fn() }) }))
const template = { id: 't1', name: '来店済み', description: '説明', template_type: 'tag', revision: 3, updated_at: '2026-09-12T00:00:00Z' }
const detail = { template, definition: { schemaVersion: 1, tag: { name: '来店済み', folderId: 'f1' }, folders: [{ id: 'f1', name: '来店管理' }] } }
const accounts = [{ id: 'a', name: '銀座本店' }, { id: 'b', name: '横浜店' }]
const checked = (): Preflight => ({ preflightId: 'p1', expiresAt: new Date(Date.now() + 60_000).toISOString(), stores: accounts.map(a => ({ accountId: a.id, accountName: a.name, items: [{ sourceId: 'tag1', itemKind: 'tag', name: '来店済み', expectedRevision: 'v3', duplicate: true, allowedModes: a.id === 'a' ? ['overwrite','alias'] : ['alias'] }] })) })
const completed = { runId: 'p1', status: 'partial', stores: [{ accountId: 'a', status: 'succeeded', counts: { created: 1, overwritten: 2, aliased: 1 } }, { accountId: 'b', status: 'version_conflict', reason: '配布先で編集がありました。もう一度確認してください', counts: { created: 0, overwritten: 0, aliased: 0 } }] }
beforeEach(() => {
  vi.resetAllMocks(); window.history.replaceState(null, '', '/hq/templates?type=tag')
  calls.list.mockResolvedValue([template]); calls.accounts.mockResolvedValue(accounts); calls.get.mockResolvedValue(structuredClone(detail))
  calls.create.mockResolvedValue(structuredClone(detail)); calls.update.mockResolvedValue(structuredClone(detail))
  calls.preflight.mockImplementation(async () => checked()); calls.distribute.mockResolvedValue(completed); calls.result.mockResolvedValue(completed)
})
afterEach(cleanup)
async function list() { render(<TemplateConsole type="tag" />); await screen.findByLabelText('来店済みの操作'); fireEvent.click(screen.getByLabelText('来店済みの操作')) }
async function chooseStores() {
  await list(); fireEvent.click(screen.getByRole('button', { name: '来店済みを配布' })); await screen.findByRole('checkbox', { name: '銀座本店' })
  expect((screen.getByRole('button', { name: '0店舗の重複を確認' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: '表示中をすべて選択' })); fireEvent.click(screen.getByRole('button', { name: '2店舗の重複を確認' })); await screen.findByText('重複する項目が2件あります')
}
async function distribute() { await chooseStores(); fireEvent.click(screen.getByRole('button', { name: 'すべて別名で作成' })); fireEvent.click(screen.getByRole('button', { name: 'この内容で2店舗へ配布' })); await screen.findByText('配布が完了しました') }

describe('HQひな形の配布フロー', () => {
  it('作成・編集で期待版と参照先を保ち、保存結果から次へ進む', async () => {
    await list(); fireEvent.click(screen.getByRole('button', { name: '来店済みを編集' })); await screen.findByLabelText('名前')
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '保存名' } }); fireEvent.click(screen.getByRole('button', { name: '保存して配布先を選ぶ' }))
    await screen.findByRole('checkbox', { name: '銀座本店' })
    expect(calls.update).toHaveBeenCalledWith('t1', expect.objectContaining({ expectedRevision: 3, name: '保存名', definition: expect.objectContaining({ folders: detail.definition.folders }) }))
    expect(calls.distribute).not.toHaveBeenCalled()
  })
  it('新規作成は必須名が必要で、作成したひな形を表示する', async () => {
    await list(); fireEvent.click(screen.getByRole('button', { name: '＋ひな形を作成' }))
    expect((screen.getByRole('button', { name: '下書き保存' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '来店済み' } }); fireEvent.click(screen.getByRole('button', { name: '下書き保存' }))
    await screen.findByText('ひな形を保存しました。'); expect(calls.create).toHaveBeenCalledOnce(); expect(calls.update).not.toHaveBeenCalled()
  })
  it('選択なしと重複未選択を止め、一括設定は許可された項目だけに適用する', async () => {
    await chooseStores(); const execute = screen.getByRole('button', { name: 'この内容で2店舗へ配布' }) as HTMLButtonElement
    expect(execute.disabled).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'すべて上書き' })); expect(execute.disabled).toBe(true)
    const group = within(screen.getByRole('group', { name: '横浜店 来店済みの配布方法' }))
    expect((group.getByRole('button', { name: '上書き' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(group.getByRole('button', { name: '別名で作成' })); expect(execute.disabled).toBe(false)
    fireEvent.click(execute); fireEvent.click(execute); await screen.findByText('配布が完了しました')
    expect(calls.distribute).toHaveBeenCalledExactlyOnceWith('t1', 'p1', [{ accountId: 'a', sourceId: 'tag1', mode: 'overwrite' }, { accountId: 'b', sourceId: 'tag1', mode: 'alias' }])
  })
  it('有効期限切れの確認では実行できない', async () => {
    calls.preflight.mockResolvedValue({ ...checked(), expiresAt: '2020-01-01T00:00:00Z' }); await chooseStores()
    fireEvent.click(screen.getByRole('button', { name: 'すべて別名で作成' })); expect((screen.getByRole('button', { name: 'この内容で2店舗へ配布' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls.distribute).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '現在版を再確認' })).toBeTruthy()
  })
  it('配布先が差し替わった事前確認を拒否する', async () => {
    calls.preflight.mockResolvedValue({ ...checked(), stores: [{ ...checked().stores[0], accountId: 'outside' }] })
    await list(); fireEvent.click(screen.getByRole('button', { name: '来店済みを配布' })); await screen.findByRole('checkbox', { name: '銀座本店' }); fireEvent.click(screen.getByRole('checkbox', { name: '銀座本店' })); fireEvent.click(screen.getByRole('button', { name: '1店舗の重複を確認' }))
    await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: /この内容で/ })).toBeNull(); expect(calls.distribute).not.toHaveBeenCalled()
  })
  it('失敗店舗だけを新しい事前確認へ戻し、成功分は再送しない', async () => {
    await distribute(); expect(screen.getByText('この店舗の変更は取り消しました')).toBeTruthy()
    calls.preflight.mockResolvedValue({ ...checked(), preflightId: 'p2', stores: [checked().stores[1]] })
    fireEvent.click(screen.getByRole('button', { name: '失敗1店舗を再確認' })); await screen.findByText('重複する項目が1件あります')
    expect(calls.preflight).toHaveBeenLastCalledWith('t1', ['b']); expect((screen.getByRole('button', { name: 'この内容で1店舗へ配布' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('POST応答不達は既存結果をGETし、二重POSTしない', async () => {
    calls.distribute.mockRejectedValue(new Error('network')); await distribute()
    expect(calls.result).toHaveBeenCalledWith('t1', 'p1'); expect(calls.distribute).toHaveBeenCalledOnce(); expect(window.location.hash).toContain('run=p1')
  })
  it('復元も不達なら成功・失敗を断定せず、GET再確認だけを提供する', async () => {
    calls.distribute.mockRejectedValue(new Error('network')); calls.result.mockRejectedValue(new Error('network')); await chooseStores()
    fireEvent.click(screen.getByRole('button', { name: 'すべて別名で作成' })); fireEvent.click(screen.getByRole('button', { name: 'この内容で2店舗へ配布' })); await screen.findByRole('alert')
    expect(screen.queryByText('配布が完了しました')).toBeNull(); expect(screen.queryByText('失敗1店舗を再確認')).toBeNull()
    calls.result.mockResolvedValue(completed); fireEvent.click(screen.getByRole('button', { name: '結果を再確認' })); await screen.findByText('配布が完了しました'); expect(calls.distribute).toHaveBeenCalledOnce()
  })
  it('再読み込みはURLの既存配布番号をGETで復元する', async () => {
    window.history.replaceState(null, '', '/hq/templates?type=tag#template=t1&run=p1'); render(<TemplateConsole type="tag" />)
    await screen.findByText('配布が完了しました'); expect(calls.result).toHaveBeenCalledWith('t1', 'p1'); expect(calls.distribute).not.toHaveBeenCalled()
  })
  it.each(['template','rich_menu','form'] as const)('未対応 %s には操作もAPI呼び出しも無い', async type => {
    render(<TemplateConsole type={type} />); expect(screen.getByText(/UNSUPPORTED/)).toBeTruthy(); expect(screen.queryByRole('button', { name: '＋ひな形を作成' })).toBeNull(); expect(calls.list).not.toHaveBeenCalled()
  })
  it('権限不足のAPI応答後に作成・配布を許可しない', async () => {
    calls.accounts.mockRejectedValue(new Error('操作する権限がありません。')); render(<TemplateConsole type="tag" />); await screen.findByRole('alert')
    expect((screen.getByRole('button', { name: '＋ひな形を作成' }) as HTMLButtonElement).disabled).toBe(true); expect(calls.create).not.toHaveBeenCalled()
  })
  it('競合した編集は入力を保持し、自動で期待版を更新・再送しない', async () => {
    calls.update.mockRejectedValue(new Error('別の担当者が更新しました。')); await list(); fireEvent.click(screen.getByRole('button', { name: '来店済みを編集' })); await screen.findByLabelText('名前')
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '手元の編集' } }); fireEvent.click(screen.getByRole('button', { name: '下書き保存' })); await screen.findByRole('alert')
    expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe('手元の編集'); expect(calls.update).toHaveBeenCalledOnce()
  })
  it('空の確認や許可されない新規作成を実行対象にしない', () => {
    expect(resolvedItems({ ...checked(), stores: [] }, {})).toBeNull()
    const p = checked(); p.stores[0].items[0].duplicate = false; p.stores[0].items[0].allowedModes = ['alias']; expect(resolvedItems(p, {})).toBeNull()
  })
})
