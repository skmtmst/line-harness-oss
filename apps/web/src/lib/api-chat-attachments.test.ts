import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let api: typeof import('./api').api;
beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example';
  ({ api } = await import('./api'));
});
afterEach(() => { vi.unstubAllGlobals(); });
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
const attachment = { id: 'file', filename: '案内.pdf', url: 'https://worker.example/images/chat-attachments/file', size: 10, mimeType: 'application/pdf', kind: 'file', expiresAt: '2026-11-01T00:00:00Z' };

describe('受信箱の添付API関数', () => {
  it('ファイルは元のバイト・形式・符号化した名前を送り、URLを受け取る', async () => {
    const fetch = vi.fn().mockResolvedValue(response(attachment, 201)); vi.stubGlobal('fetch', fetch);
    const file = new File(['%PDF-1.7'], '案内.pdf', { type: 'application/pdf' });
    const result = await api.chats.attachments.upload('友だち/1', file);
    expect(result.data).toEqual(attachment);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://worker.example/api/chats/%E5%8F%8B%E3%81%A0%E3%81%A1%2F1/attachments/upload');
    expect(init.body).toBe(file);
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/pdf');
    expect(new Headers(init.headers).get('X-Filename')).toBe(encodeURIComponent('案内.pdf'));
  });
  it('動画は準備→認証情報なしのR2 PUT→ETag付き完了の順で送る', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ id: 'session', uploadUrl: 'https://r2.example/signed', requiredHeaders: { 'Content-Type': 'video/mp4' } }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"etag"' } }))
      .mockResolvedValueOnce(response({ ...attachment, kind: 'video' }, 201));
    vi.stubGlobal('fetch', fetch);
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    await api.chats.attachments.upload('f1', file);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      'https://worker.example/api/chats/f1/attachments/upload-sessions', 'https://r2.example/signed',
      'https://worker.example/api/chats/f1/attachments/upload-sessions/session/complete',
    ]);
    expect(fetch.mock.calls[1][1]).toEqual({ method: 'PUT', body: file, credentials: 'omit', headers: { 'Content-Type': 'video/mp4' } });
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ etag: '"etag"' });
  });
  it.each([500, 200])('動画PUTが%sでも失敗・ETag欠落なら完了を呼ばない', async status => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ id: 'session', uploadUrl: 'https://r2.example/signed', requiredHeaders: {} }, 201))
      .mockResolvedValueOnce(new Response(null, { status })); vi.stubGlobal('fetch', fetch);
    await expect(api.chats.attachments.upload('f1', new File(['video'], 'a.mp4', { type: 'video/mp4' }))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('準備に失敗したらR2へ送らない', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: '未設定' }), { status: 503, headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    await expect(api.chats.attachments.upload('f1', new File(['video'], 'a.mp4', { type: 'video/mp4' }))).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['image', 'video', 'file'] as const)('%sの送信と予約で種別・内容・冪等キーを保持する', async messageType => {
    const fetch = vi.fn().mockImplementation(async () => response({ sent: true })); vi.stubGlobal('fetch', fetch);
    const input = { messageType, content: messageType === 'file' ? '{"attachmentId":"file"}' : '{"originalContentUrl":"https://worker.example/a","previewImageUrl":"https://worker.example/b"}' };
    await api.chats.send('f1', input, 'send-key');
    await api.chats.schedule('f1', { ...input, scheduledAt: '2026-10-15T00:00:00Z' }, 'schedule-key');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject(input);
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Idempotency-Key')).toBe('send-key');
    expect(new Headers(fetch.mock.calls[1][1].headers).get('Idempotency-Key')).toBe('schedule-key');
  });
});
