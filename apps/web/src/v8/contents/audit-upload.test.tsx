// @vitest-environment happy-dom
import React from 'react'
import type { MediaItem } from '@line-crm/shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ prepareUploads: vi.fn(), completeUpload: vi.fn(), put: vi.fn(), previewVersion: vi.fn() }))
vi.mock('@/lib/api', async original => ({ ...(await original<typeof import('@/lib/api')>()), api: { media: { ...net, deleteImpact: async () => ({ success: true, data: { usageCount: 0, references: [], versions: [] } }), contentUrl: () => 'https://example.test/image.png' }, fileScan: { forMedia: async () => ({ success: true, data: { scan: { status: 'clean' } } }) } } }))
vi.mock('./media-direct-upload', () => ({ MEDIA_ACCEPT: 'image/png', extractMediaMetadata: async () => ({ width: 10, height: 10 }), putMediaFile: net.put, validateMediaFile: () => null, fileMatchesMediaKind: () => true, mediaAcceptForKind: () => 'image/png' }))
import Upload from './media-upload-dialog'
import Detail from './media-detail-dialog'
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('WEB-095: 完了応答だけ失われた登録は同じセッションから再試行する', async () => {
 net.prepareUploads.mockResolvedValue({ success: true, data: { sessions: [{ id: 'session' }] } })
 net.put.mockResolvedValue('etag')
 net.completeUpload.mockRejectedValueOnce(new Error('完了の通信失敗')).mockResolvedValue({ success: true, data: { status: 'completed', mediaId: 'media' } })
 render(<Upload open accountId="a" folders={[]} initialFolderId="" onClose={() => {}} onComplete={() => {}} />)
 fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['png'], 'a.png', { type: 'image/png' })] } })
 fireEvent.click(screen.getByRole('button', { name: /登録する/ }))
 await screen.findByText('完了の通信失敗')
 fireEvent.click(screen.getByRole('button', { name: '「a.png」を選び直す' }))
 fireEvent.click(screen.getByRole('button', { name: /登録する/ }))
 await waitFor(() => expect(net.completeUpload).toHaveBeenCalledTimes(2))
 expect(net.prepareUploads).toHaveBeenCalledTimes(1)
 expect(net.put).toHaveBeenCalledTimes(1)
})
it('WEB-096: 確認中のファイルを別のファイル表示に差し替えない', async () => {
 let finish!: (v: unknown) => void
 net.prepareUploads.mockImplementation(() => new Promise(r => { finish = r }))
 net.put.mockResolvedValue('etag')
 net.completeUpload.mockResolvedValue({ success: true, data: { status: 'verified' } })
 net.previewVersion.mockResolvedValue({ success: true, data: { blockers: [], canReplace: true, uploadSessionId: 'session', references: [] } })
 render(<Detail item={{ id: 'media', filename: '元.png', kind: 'image', mimeType: 'image/png', sizeBytes: 10 } as MediaItem} accountId="a" folderName="" canManage onClose={() => {}} onOpenReplacement={() => {}} onVersionCreated={() => {}} />)
 const input = document.querySelector('input[type="file"]')!
 fireEvent.change(input, { target: { files: [new File(['a'], 'A.png', { type: 'image/png' })] } })
 fireEvent.click(screen.getByRole('button', { name: /差し替え.*確認|中身.*確認|内容.*確認/ }))
 await waitFor(() => expect(net.prepareUploads).toHaveBeenCalled())
 fireEvent.change(input, { target: { files: [new File(['b'], 'B.png', { type: 'image/png' })] } })
 await act(async () => finish({ success: true, data: { sessions: [{ id: 'session' }] } }))
 expect(screen.queryByText('B.png')).toBeNull()
 expect(screen.getByText('A.png')).toBeTruthy()
})

it('登録メディアの閲覧者には使えない版追加の入力やボタンを出さない', async () => {
 render(<Detail item={{ id: 'media', filename: '元.png', kind: 'image', mimeType: 'image/png', sizeBytes: 10 } as MediaItem} accountId="a" folderName="" canManage={false} onClose={() => {}} onOpenReplacement={() => {}} onVersionCreated={() => {}} />)
 await waitFor(() => expect(screen.getByRole('button', { name: 'ダウンロード' })).toBeTruthy())
 expect(document.querySelector('input[type="file"]')).toBeNull()
 expect(screen.queryByRole('button', { name: '差し替え内容を確認' })).toBeNull()
})
