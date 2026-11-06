import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'

const calls = vi.hoisted(() => ({
  validate: vi.fn(), metadata: vi.fn(), prepare: vi.fn(), put: vi.fn(), complete: vi.fn(), detail: vi.fn(), image: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ api: {
  media: { prepareUploads: calls.prepare, completeUpload: calls.complete, detail: calls.detail },
  uploads: { image: calls.image },
} }))
vi.mock('@/v8/contents/public/media-direct-upload/index', () => ({
  validateMediaFile: calls.validate, extractMediaMetadata: calls.metadata, putMediaFile: calls.put,
}))
import { uploadImageFile, uploadToMediaLibrary } from './media-library-upload'

const session = { id: 'session', method: 'PUT', uploadUrl: 'https://upload.example.test/private', requiredHeaders: {} }
const metadata = { durationMs: 1200 }
const item = { id: 'media', kind: 'video', url: 'https://media.example.test/video.mp4' } as MediaItem
const prepared = { success: true, data: { sessions: [session] } }
const completed = { success: true, data: { status: 'completed', mediaId: item.id } }
const stopped = '権限が変わったため、ファイルの登録を中止しました。'
const file = () => new File(['video'], 'clip.mp4', { type: 'video/mp4' })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  Object.values(calls).forEach(call => call.mockReset())
  calls.validate.mockReturnValue('')
  calls.metadata.mockResolvedValue(metadata)
  calls.prepare.mockResolvedValue(prepared)
  calls.put.mockResolvedValue('etag')
  calls.complete.mockResolvedValue(completed)
  calls.detail.mockResolvedValue({ success: true, data: { item } })
  calls.image.mockResolvedValue({ success: true, data: { url: 'https://media.example.test/image.png' } })
})

describe('登録メディアの書込ごとの権限確認', () => {
  it('内容情報を読んだ後、準備の直前で失効していれば書込を一切始めない', async () => {
    const pending = deferred<typeof metadata>()
    calls.metadata.mockReturnValue(pending.promise)
    let allowed = true
    const work = uploadToMediaLibrary(file(), 'account', 'video', undefined, () => allowed)
    allowed = false
    pending.resolve(metadata)
    await expect(work).rejects.toThrow(stopped)
    expect(calls.metadata).toHaveBeenCalledTimes(1)
    expect(calls.prepare).not.toHaveBeenCalled()
    expect(calls.put).not.toHaveBeenCalled()
    expect(calls.complete).not.toHaveBeenCalled()
  })

  it('準備の応答中に失効したらPUTと完了を始めず、復旧しても旧処理を再開しない', async () => {
    const pending = deferred<typeof prepared>()
    calls.prepare.mockReturnValue(pending.promise)
    let allowed = true
    const work = uploadToMediaLibrary(file(), 'account', 'video', undefined, () => allowed)
    await vi.waitFor(() => expect(calls.prepare).toHaveBeenCalledTimes(1))
    allowed = false
    pending.resolve(prepared)
    await expect(work).rejects.toThrow(stopped)
    allowed = true
    await Promise.resolve()
    expect(calls.put).not.toHaveBeenCalled()
    expect(calls.complete).not.toHaveBeenCalled()
    expect(calls.detail).not.toHaveBeenCalled()
  })

  it('PUTの応答中に失効したら完了を始めず、既に送ったファイルを成功扱いしない', async () => {
    const pending = deferred<string>()
    calls.put.mockReturnValue(pending.promise)
    let allowed = true
    const work = uploadToMediaLibrary(file(), 'account', 'video', undefined, () => allowed)
    await vi.waitFor(() => expect(calls.put).toHaveBeenCalledTimes(1))
    allowed = false
    pending.resolve('etag')
    await expect(work).rejects.toThrow(stopped)
    expect(calls.prepare).toHaveBeenCalledTimes(1)
    expect(calls.put).toHaveBeenCalledTimes(1)
    expect(calls.complete).not.toHaveBeenCalled()
    expect(calls.detail).not.toHaveBeenCalled()
  })

  it('完了が既に始まった後の失効では、保存済みの正本を読むGETを止めない', async () => {
    const pending = deferred<typeof completed>()
    calls.complete.mockReturnValue(pending.promise)
    let allowed = true
    const lease = vi.fn(() => allowed)
    const work = uploadToMediaLibrary(file(), 'account', 'video', undefined, lease)
    await vi.waitFor(() => expect(calls.complete).toHaveBeenCalledTimes(1))
    allowed = false
    pending.resolve(completed)
    await expect(work).resolves.toEqual({ url: item.url, durationMs: 1200, item })
    expect(calls.detail).toHaveBeenCalledExactlyOnceWith(item.id, 'account')
    expect(lease).toHaveBeenCalledTimes(3)
    // 返った正本を画面の値へ反映するかは呼ぶ側の失効leaseで別に確かめる。
  })

  it('呼ぶ側が失効を記憶したleaseは、役割が戻ってから応答しても次の書込を許可しない', async () => {
    const pending = deferred<typeof prepared>()
    calls.prepare.mockReturnValue(pending.promise)
    let active = true
    let expired = false
    const lease = () => active && !expired
    const work = uploadToMediaLibrary(file(), 'account', 'video', undefined, lease)
    await vi.waitFor(() => expect(calls.prepare).toHaveBeenCalledTimes(1))
    active = false; expired = true; active = true
    pending.resolve(prepared)
    await expect(work).rejects.toThrow(stopped)
    expect(calls.put).not.toHaveBeenCalled()
  })

  it('未指定は同じ引数・順序・回数で保存し、進捗と正本と長さを返す', async () => {
    const input = file(); const progress = vi.fn(); const order: string[] = []
    calls.validate.mockImplementation(() => { order.push('validate'); return '' })
    calls.metadata.mockImplementation(async () => { order.push('metadata'); return metadata })
    calls.prepare.mockImplementation(async () => { order.push('prepare'); return prepared })
    calls.put.mockImplementation(async (_session, _file, callback) => { order.push('put'); callback(67); return 'etag' })
    calls.complete.mockImplementation(async () => { order.push('complete'); return completed })
    calls.detail.mockImplementation(async () => { order.push('detail'); return { success: true, data: { item } } })
    await expect(uploadToMediaLibrary(input, 'account', 'video', progress)).resolves.toEqual({ url: item.url, durationMs: 1200, item })
    expect(order).toEqual(['validate', 'metadata', 'prepare', 'put', 'complete', 'detail'])
    expect(calls.prepare).toHaveBeenCalledExactlyOnceWith({ accountId: 'account', files: [{ filename: input.name, mimeType: input.type, sizeBytes: input.size, folderId: null, metadata }] })
    expect(calls.put).toHaveBeenCalledExactlyOnceWith(session, input, progress)
    expect(calls.complete).toHaveBeenCalledExactlyOnceWith('session', { accountId: 'account', etag: 'etag' })
    expect(calls.detail).toHaveBeenCalledExactlyOnceWith(item.id, 'account')
    expect(progress).toHaveBeenCalledExactlyOnceWith(67)
  })

  it('未指定の進捗callbackは省略でき、許可callbackがtrueなら従来の保存を通す', async () => {
    calls.put.mockImplementation(async (_session, _file, progress) => { progress(100); return 'etag' })
    await expect(uploadToMediaLibrary(file(), 'account', 'video', undefined, () => true)).resolves.toMatchObject({ url: item.url })
    expect(calls.complete).toHaveBeenCalledTimes(1)
  })

  it('ファイルの検査で拒否したら、内容情報も書込も始めない', async () => {
    calls.validate.mockReturnValue('形式を確認してください')
    await expect(uploadToMediaLibrary(file(), 'account', 'video')).rejects.toThrow('形式を確認してください')
    expect(calls.metadata).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled()
  })

  it.each([
    { success: false, error: '容量が足りません' },
    { success: true, data: { sessions: [] } },
    { success: true, data: { sessions: [session, session] } },
  ])('準備が失敗/1件でない時はPUTを始めない %j', async response => {
    calls.prepare.mockResolvedValue(response)
    await expect(uploadToMediaLibrary(file(), 'account', 'video')).rejects.toThrow()
    expect(calls.put).not.toHaveBeenCalled(); expect(calls.complete).not.toHaveBeenCalled()
  })

  it('PUTが失敗したら完了を始めず、元の失敗を返す', async () => {
    calls.put.mockRejectedValue(new Error('送信失敗'))
    await expect(uploadToMediaLibrary(file(), 'account', 'video')).rejects.toThrow('送信失敗')
    expect(calls.complete).not.toHaveBeenCalled()
  })

  it.each([
    { success: false, error: '登録失敗' },
    { success: true, data: { status: 'pending', mediaId: item.id } },
    { success: true, data: { status: 'completed', mediaId: '' } },
  ])('完了していない結果を成功扱いせずGETも始めない %j', async response => {
    calls.complete.mockResolvedValue(response)
    await expect(uploadToMediaLibrary(file(), 'account', 'video')).rejects.toThrow()
    expect(calls.detail).not.toHaveBeenCalled()
  })

  it.each([
    { success: false, error: '読込失敗' },
    { success: true, data: { item: { ...item, kind: 'audio' } } },
    { success: true, data: { item: { ...item, url: '' } } },
  ])('正本を確認できなければ送信時のURLを代用しない %j', async response => {
    calls.detail.mockResolvedValue(response)
    await expect(uploadToMediaLibrary(file(), 'account', 'video')).rejects.toThrow('登録したファイルを確認できませんでした')
  })

  it('既存の単画像アップロードは同じ1回のAPIでURLを返す', async () => {
    const input = file()
    await expect(uploadImageFile(input)).resolves.toBe('https://media.example.test/image.png')
    expect(calls.image).toHaveBeenCalledExactlyOnceWith(input)
    expect(calls.prepare).not.toHaveBeenCalled()
  })
})
