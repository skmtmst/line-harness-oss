import { describe, expect, it, vi } from 'vitest';
import { generateOpenAIImage, OpenAIImageError } from './openai-images.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const b64 = btoa(String.fromCharCode(...PNG_BYTES));

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } },
  )) as unknown as typeof fetch;
}

describe('OpenAI 画像生成の呼び出し', () => {
  it('1枚分のリクエストを組み立て、JPEG のバイト列を返す', async () => {
    const fetchImpl = fakeFetch(200, { data: [{ b64_json: b64 }], model: 'gpt-image-test' });
    const result = await generateOpenAIImage({
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      prompt: 'テスト',
      size: '1024x1024',
      quality: 'low',
      fetchImpl,
    });
    expect(result.bytes).toEqual(PNG_BYTES);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.model).toBe('gpt-image-test');

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      model: 'gpt-image-1',
      n: 1,
      size: '1024x1024',
      quality: 'low',
      output_format: 'jpeg',
    });
  });

  it.each([
    [401, { error: { message: 'Incorrect API key' } }, 'auth'],
    [429, { error: { message: 'Rate limit' } }, 'rate_limit'],
    [400, { error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system' } }, 'safety'],
    [400, { error: { message: 'Invalid size' } }, 'invalid'],
    [500, 'oops', 'server'],
  ])('HTTP %s は種別 %s のエラーにする', async (status, body, kind) => {
    const promise = generateOpenAIImage({
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      prompt: 'テスト',
      size: '1024x1024',
      quality: 'low',
      fetchImpl: fakeFetch(status, body),
    });
    await expect(promise).rejects.toBeInstanceOf(OpenAIImageError);
    await promise.catch((error: OpenAIImageError) => {
      expect(error.kind).toBe(kind);
      expect(error.userMessage).not.toMatch(/[a-z]{4,}/i);
    });
  });

  it('画像が返らなければサーバー側の失敗として扱う', async () => {
    const promise = generateOpenAIImage({
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      prompt: 'テスト',
      size: '1024x1024',
      quality: 'low',
      fetchImpl: fakeFetch(200, { data: [] }),
    });
    await expect(promise).rejects.toMatchObject({ kind: 'server' });
  });
});
