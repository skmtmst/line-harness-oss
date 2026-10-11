import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPENAI_TEXT_MODEL, OpenAITextError, generateOpenAIText } from './openai-text';

/** OpenAI の返事を1回だけ真似る。送られた中身も覚えておく。 */
function stubFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function request(overrides: Partial<Parameters<typeof generateOpenAIText>[0]> = {}) {
  return {
    apiKey: 'sk-test',
    model: DEFAULT_OPENAI_TEXT_MODEL,
    system: 'あなたは飲食店の返信を書く人です。',
    user: '季節の定食がおいしかった',
    maxOutputTokens: 3000,
    ...overrides,
  };
}

describe('OpenAI の文章生成', () => {
  it('文章を受け取り、前後の空白を落として返す', async () => {
    const { impl, calls } = stubFetch({ choices: [{ message: { content: '  この度はありがとうございました。  ' } }] });
    const text = await generateOpenAIText(request({ fetchImpl: impl }));
    expect(text).toBe('この度はありがとうございました。');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('gpt-5 系は max_completion_tokens と考える量を送り、temperature は送らない', async () => {
    const { impl, calls } = stubFetch({ choices: [{ message: { content: 'ok' } }] });
    await generateOpenAIText(request({ fetchImpl: impl, temperature: 0.5 }));
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5-mini',
      max_completion_tokens: 3000,
      reasoning_effort: 'low',
    });
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages).toEqual([
      { role: 'system', content: 'あなたは飲食店の返信を書く人です。' },
      { role: 'user', content: '季節の定食がおいしかった' },
    ]);
  });

  it('考えないモデルのときだけ temperature を送る', async () => {
    const { impl, calls } = stubFetch({ choices: [{ message: { content: 'ok' } }] });
    await generateOpenAIText(request({ fetchImpl: impl, model: 'gpt-4o-mini', temperature: 0.5 }));
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'gpt-4o-mini', temperature: 0.5 });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'invalid'],
    [404, 'invalid'],
    [422, 'invalid'],
    [500, 'server'],
    [503, 'server'],
  ])('%i のときは %s として分ける', async (status, kind) => {
    const { impl } = stubFetch({ error: { message: 'ng' } }, status);
    await expect(generateOpenAIText(request({ fetchImpl: impl }))).rejects.toMatchObject({
      name: 'OpenAITextError',
      kind,
      status,
    });
  });

  it('文章が空のときは empty として分ける', async () => {
    const { impl } = stubFetch({ choices: [{ message: { content: '   ' } }] });
    await expect(generateOpenAIText(request({ fetchImpl: impl }))).rejects.toMatchObject({ kind: 'empty' });
  });

  it('返事が JSON でないときは server として分ける', async () => {
    const { impl } = stubFetch('<html>maintenance</html>');
    await expect(generateOpenAIText(request({ fetchImpl: impl }))).rejects.toMatchObject({ kind: 'server' });
  });

  it('時間切れのときは timeout として分ける', async () => {
    const impl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      // 中断の合図を待つだけ。実際の OpenAI が遅いときと同じ形にする。
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
      return new Response('{}');
    }) as unknown as typeof fetch;
    await expect(generateOpenAIText(request({ fetchImpl: impl, timeoutMs: 5 }))).rejects.toMatchObject({
      kind: 'timeout',
      status: null,
    });
  });

  it('通信そのものが失敗したときも種類の付いた失敗にする', async () => {
    const impl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const error = await generateOpenAIText(request({ fetchImpl: impl })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OpenAITextError);
    expect(error).toMatchObject({ kind: 'server', detail: 'network down' });
  });
});
