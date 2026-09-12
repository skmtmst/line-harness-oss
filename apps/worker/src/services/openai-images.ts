/**
 * OpenAI の画像生成API（gpt-image 系）を呼ぶ薄い層。
 *
 * ここでは「1回の呼び出しで1枚」だけを扱う。複数枚は呼び出し側が
 * 1枚ずつ回す。1枚ごとに保存するので、途中で失敗しても成功分は残る。
 *
 * 出力は JPEG にする。LINE の画像メッセージはプレビューが 1MB までなので、
 * PNG のままだと超えやすい。
 */

export type OpenAIImageQuality = 'low' | 'medium' | 'high';
export type OpenAIImageSize = '1024x1024' | '1536x1024' | '1024x1536';

export interface OpenAIImageRequest {
  apiKey: string;
  model: string;
  prompt: string;
  size: OpenAIImageSize;
  quality: OpenAIImageQuality;
  /** 0〜100。JPEG の圧縮率。 */
  outputCompression?: number;
  /** テストで差し替えるため。 */
  fetchImpl?: typeof fetch;
  /** OpenAI の応答を待つ上限（ミリ秒）。 */
  timeoutMs?: number;
}

export interface OpenAIImageResult {
  bytes: Uint8Array;
  mimeType: 'image/jpeg';
  /** 実際に使われたモデル名。応答に無ければ要求したもの。 */
  model: string;
}

export type OpenAIImageErrorKind = 'safety' | 'auth' | 'rate_limit' | 'timeout' | 'invalid' | 'server';

export class OpenAIImageError extends Error {
  constructor(readonly kind: OpenAIImageErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'OpenAIImageError';
  }

  /** 運用者に見せる文。内部の英語メッセージはそのまま出さない。 */
  get userMessage(): string {
    switch (this.kind) {
      case 'safety':
        return 'この内容はAIの安全基準に触れたため生成できませんでした。表現を変えてもう一度お試しください。';
      case 'auth':
        return '画像生成の接続設定に問題があります。運営にお問い合わせください。';
      case 'rate_limit':
        return '画像生成の混雑により受け付けられませんでした。少し待ってからもう一度お試しください。';
      case 'timeout':
        return '画像生成に時間がかかりすぎたため中断しました。品質を下げるか、もう一度お試しください。';
      case 'invalid':
        return '生成条件をAIが受け付けませんでした。テキストを短くするか表現を変えてお試しください。';
      default:
        return '画像生成サービス側でエラーが起きました。しばらく経ってからもう一度お試しください。';
    }
  }
}

/** 既定モデル。gpt-image-1 は 2026-10 に廃止予定なので、Banas と同じ gpt-image-2 を使う。 */
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_TIMEOUT_MS = 120_000;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function classifyFailure(status: number, body: string): OpenAIImageError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return new OpenAIImageError('auth', body, status);
  if (status === 429) return new OpenAIImageError('rate_limit', body, status);
  if (/safety|moderation|content_policy|content policy|rejected/.test(lower)) {
    return new OpenAIImageError('safety', body, status);
  }
  if (status === 400 || status === 422) return new OpenAIImageError('invalid', body, status);
  return new OpenAIImageError('server', body, status);
}

export async function generateOpenAIImage(request: OpenAIImageRequest): Promise<OpenAIImageResult> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        size: request.size,
        quality: request.quality,
        output_format: 'jpeg',
        output_compression: request.outputCompression ?? 85,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OpenAIImageError('timeout', 'OpenAI image generation timed out');
    }
    throw new OpenAIImageError('server', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; code?: string } };
      message = [parsed.error?.code, parsed.error?.message].filter(Boolean).join(': ') || text;
    } catch {
      // 本文が JSON でなければそのまま使う
    }
    throw classifyFailure(response.status, message);
  }

  let parsed: { data?: Array<{ b64_json?: string }>; model?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new OpenAIImageError('server', 'OpenAI returned a non-JSON body');
  }
  const first = parsed.data?.[0];
  if (!first?.b64_json) {
    throw new OpenAIImageError('server', 'OpenAI returned no image data');
  }
  return {
    bytes: decodeBase64(first.b64_json),
    mimeType: 'image/jpeg',
    model: parsed.model ?? request.model,
  };
}
