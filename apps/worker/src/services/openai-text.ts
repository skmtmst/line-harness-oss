import { tracedFetch as fetch } from '@line-crm/shared/server';
/**
 * OpenAI の文章生成（Chat Completions）を呼ぶ共通処理。
 * 画像生成（openai-images.ts）と同じ OPENAI_API_KEY を使う。
 * 失敗の種類を分けて返すので、呼び出し側は「鍵がない／混んでいる／時間切れ」を見分けられる。
 */

export type OpenAITextFailure = 'auth' | 'rate_limit' | 'invalid' | 'server' | 'timeout' | 'empty';

export class OpenAITextError extends Error {
  constructor(
    readonly kind: OpenAITextFailure,
    readonly status: number | null = null,
    readonly detail: string = '',
  ) {
    super(`openai_text_${kind}`);
    this.name = 'OpenAITextError';
  }
}

/** 既定モデル。口コミ返信のような日本語の敬語文を安く書けるもの。 */
export const DEFAULT_OPENAI_TEXT_MODEL = 'gpt-5-mini';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface OpenAITextRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** 返ってくる文章の上限トークン数。考える分も含むので余裕を持たせる。 */
  maxOutputTokens: number;
  /** gpt-5 系は temperature を受け付けないので、その場合は送らない。 */
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  store?:false;
}

function classifyFailure(status: number, body: string): OpenAITextError {
  if (status === 401 || status === 403) return new OpenAITextError('auth', status, body);
  if (status === 429) return new OpenAITextError('rate_limit', status, body);
  if (status === 400 || status === 404 || status === 422) return new OpenAITextError('invalid', status, body);
  return new OpenAITextError('server', status, body);
}

/** gpt-5 系は考える量を指定でき、temperature は固定。 */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[134])/.test(model);
}

export async function generateOpenAIText(request: OpenAITextRequest): Promise<string> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const reasoning = isReasoningModel(request.model);
  const payload: Record<string, unknown> = {
    model: request.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    max_completion_tokens: request.maxOutputTokens,
  };
  if(request.store===false)payload.store=false;
  // 文章を書くだけなので、考える量は少なめにして待ち時間と費用を抑える。
  if (reasoning) payload.reasoning_effort = 'low';
  else if (typeof request.temperature === 'number') payload.temperature = request.temperature;

  try {
    const response = await fetchImpl(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw classifyFailure(response.status, raw.slice(0, 500));
    let parsed: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new OpenAITextError('server', response.status, raw.slice(0, 200));
    }
    const content = parsed.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) throw new OpenAITextError('empty', response.status, '');
    return text;
  } catch (error) {
    if (error instanceof OpenAITextError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new OpenAITextError('timeout');
    throw new OpenAITextError('server', null, error instanceof Error ? error.message : '');
  } finally {
    clearTimeout(timer);
  }
}
