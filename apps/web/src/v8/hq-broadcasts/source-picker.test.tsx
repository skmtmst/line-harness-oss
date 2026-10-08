// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ templates: vi.fn(), templateFolders: vi.fn(), template: vi.fn(), runs: vi.fn(), folders: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: { listByKind: calls.templates, folders: { list: calls.templateFolders }, get: calls.template } }))
vi.mock('@/lib/hq-broadcasts-api', () => ({ hqBroadcastsApi: { list: calls.runs, folders: calls.folders, get: calls.run } }))
import HqBroadcastSourcePicker from './source-picker'

const definition = (id: string, body: string) => ({ template: { id, template_type: 'template' }, definition: { schemaVersion: 1, media: [], template: { id, name: id, messageType: 'text', messageContent: body } } })
const source = (status: string) => ({ id: status, title: `${status}の配信`, status, version: 1, scheduledAt: null, targets: [], input: { title: `${status}の配信`, messageContent: `${status}の本文`, folderId: 'f1' } })
const props = { initialId: '', onTemplate: vi.fn(async () => null), onBroadcast: vi.fn(), renderBroadcast: (run: { title: string }) => <p>{`見え方：${run.title}`}</p>, onClose: vi.fn() }
beforeEach(() => {
  calls.templates.mockResolvedValue(['message', 'carousel', 'rich_message', 'question', 'coupon', 'research'].map((kind) => ({ id: kind, name: `${kind}のひな形`, kind, folder_id: 'f1', updated_at: '2026-10-08T00:00:00Z' })))
  calls.templateFolders.mockResolvedValue([{ id: 'f1', name: '案内' }])
  calls.template.mockImplementation(async (id: string) => definition(id, `${id}の本文`))
  calls.runs.mockResolvedValue({ data: ['sent', 'scheduled', 'prepared'].map(source) })
  calls.folders.mockResolvedValue({ data: [{ id: 'f1', name: '配信の分類' }] })
  calls.run.mockImplementation(async (id: string) => ({ data: source(id) }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('統括の選択窓と既存の口', () => {
  it('全6種類を一覧から選べる。仮選択のままキャンセルしても使う口は呼ばない', async () => {
    render(<HqBroadcastSourcePicker {...props} mode="template" />)
    await screen.findByRole('radio', { name: 'researchのひな形' })
    expect(screen.getAllByRole('radio')).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: /^リッチメッセージ/ }))
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'rich_messageのひな形' }))
    await screen.findByText('rich_messageの本文')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(props.onTemplate).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('選択詳細の返事が逆順でも、最後に選んだ候補の見え方を保つ', async () => {
    let finishOld!: (value: ReturnType<typeof definition>) => void
    calls.template.mockImplementation((id: string) => id === 'message' ? new Promise((resolve) => { finishOld = resolve }) : Promise.resolve(definition(id, '新しい本文')))
    render(<HqBroadcastSourcePicker {...props} mode="template" />)
    fireEvent.click(await screen.findByRole('radio', { name: 'messageのひな形' }))
    fireEvent.click(screen.getByRole('radio', { name: 'couponのひな形' }))
    await screen.findByText('新しい本文')
    await act(async () => { finishOld(definition('message', '古い本文')) })
    expect(screen.queryByText('古い本文')).toBeNull()
    expect(screen.getByText('新しい本文')).toBeTruthy()
  })

  it('送信済み・予約中・下書きで絞り、確定時に読み直した配信を写す', async () => {
    calls.run.mockResolvedValue({ data: { ...source('prepared'), title: '新しく直した配信' } })
    render(<HqBroadcastSourcePicker {...props} mode="duplicate" />)
    await screen.findByRole('radio', { name: 'preparedの配信' })
    fireEvent.click(screen.getByRole('button', { name: /^下書き/ }))
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'preparedの配信' }))
    expect(screen.getByText('見え方：preparedの配信')).toBeTruthy()
    expect(props.onBroadcast).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'この配信を写す' }))
    await waitFor(() => expect(props.onBroadcast).toHaveBeenCalledWith(expect.objectContaining({ title: '新しく直した配信' })))
    expect(calls.run).toHaveBeenCalledWith('prepared')
  })

  it('読込失敗を空一覧にせず、窓の再試行で読み直す', async () => {
    calls.templates.mockRejectedValueOnce(new Error('network'))
    render(<HqBroadcastSourcePicker {...props} mode="template" />)
    const retry = await screen.findByRole('button', { name: /もう一度|再試行/ })
    fireEvent.click(retry)
    await screen.findByRole('radio', { name: 'researchのひな形' })
    expect(calls.templates).toHaveBeenCalledTimes(2)
  })

  it('質問の未対応理由を出し、③を置き換える操作を止める', async () => {
    calls.template.mockResolvedValue({ ...definition('question', ''), definition: { ...definition('question', '').definition, template: { ...definition('question', '').definition.template, questionJson: '{}' } } })
    render(<HqBroadcastSourcePicker {...props} mode="template" />)
    fireEvent.click(await screen.findByRole('radio', { name: 'questionのひな形' }))
    await screen.findByText('質問のひな形は、まだ統括からは送れません')
    expect((screen.getByRole('button', { name: 'このテンプレートを使う' }) as HTMLButtonElement).disabled).toBe(true)
    expect(props.onTemplate).not.toHaveBeenCalled()
  })
})
