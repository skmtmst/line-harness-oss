// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import TemplateConsole from './template-console'
import type { TemplateDefinition } from '@/lib/hq-templates-api'

const calls = vi.hoisted(() => ({ uploadImage: vi.fn(), deleteImage: vi.fn(), context: vi.fn(), list: vi.fn(), accounts: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), preflight: vi.fn(), distribute: vi.fn(), result: vi.fn() }))
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form'], hqTemplatesApi: calls }))
vi.mock('next/navigation', () => ({ usePathname: () => '/hq/templates', useRouter: () => ({ push: vi.fn() }) }))

const png = (filename: string, r2Key: string) => ({ id: `id-${filename}`, kind: 'image' as const, filename, mimeType: 'image/png', sizeBytes: 32, width: 2500, height: 1686, durationMs: null, r2Key, publicUrl: `https://worker.test/images/${r2Key}`, versionId: `id-${filename}`, versionNo: 1, contentHash: 'a'.repeat(64) })
const KEY_A = 'hq-templates/tenant-a/uploads/aaaa', KEY_B = 'hq-templates/tenant-a/uploads/bbbb', KEY_M = 'hq-templates/tenant-a/uploads/mmmm'

beforeEach(() => {
  vi.resetAllMocks(); window.sessionStorage.clear(); window.history.replaceState(null, '', '/hq/templates?type=rich_menu')
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([]); calls.accounts.mockResolvedValue([])
  calls.create.mockImplementation(async (input: { definition: TemplateDefinition }) => ({ template: { id: 't1', name: 'x', template_type: 'rich_menu', revision: 1, updated_at: '2026-09-29T00:00:00Z' }, definition: input.definition }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function startCreate(label: 'リッチメニュー画像を選ぶ' | 'メッセージ画像を選ぶ') {
  render(<TemplateConsole type={label === 'メッセージ画像を選ぶ' ? 'template' : 'rich_menu'} />)
  await screen.findByRole('button', { name: '＋ひな形を作る' })
  fireEvent.click(screen.getByRole('button', { name: '＋ひな形を作る' }))
  await screen.findByLabelText(label)
}

describe('R568 cancelled or replaced uploads are reclaimed', () => {
  it('cancelling a rich menu create deletes the uploaded-but-unsaved image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2500, height: 1686, close: vi.fn() })))
    calls.uploadImage.mockResolvedValue(png('a.png', KEY_A))
    await startCreate('リッチメニュー画像を選ぶ')
    fireEvent.change(screen.getByLabelText('リッチメニュー画像を選ぶ'), { target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] } })
    await waitFor(() => expect(calls.uploadImage).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(calls.deleteImage).toHaveBeenCalledWith(KEY_A))
  })
  it('cancelling a shared message template create deletes its uploaded image', async () => {
    calls.uploadImage.mockResolvedValue(png('m.png', KEY_M))
    await startCreate('メッセージ画像を選ぶ')
    fireEvent.change(screen.getByLabelText('メッセージ画像を選ぶ'), { target: { files: [new File(['m'], 'm.png', { type: 'image/png' })] } })
    await waitFor(() => expect(calls.uploadImage).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(calls.deleteImage).toHaveBeenCalledWith(KEY_M))
  })
  it('saving deletes only the replaced image and keeps the adopted one', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2500, height: 1686, close: vi.fn() })))
    calls.uploadImage.mockResolvedValueOnce(png('a.png', KEY_A)).mockResolvedValueOnce(png('b.png', KEY_B))
    await startCreate('リッチメニュー画像を選ぶ')
    const input = screen.getByLabelText('リッチメニュー画像を選ぶ')
    fireEvent.change(input, { target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] } })
    await waitFor(() => expect(calls.uploadImage).toHaveBeenCalledTimes(1))
    fireEvent.change(input, { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } })
    await waitFor(() => expect(calls.uploadImage).toHaveBeenCalledTimes(2))
    fireEvent.change(screen.getByLabelText('メニュー名'), { target: { value: '案内' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    await waitFor(() => expect(calls.deleteImage).toHaveBeenCalledWith(KEY_A))
    expect(calls.deleteImage).not.toHaveBeenCalledWith(KEY_B)
  })
})
