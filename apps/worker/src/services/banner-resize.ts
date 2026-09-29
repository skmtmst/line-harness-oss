import type { BannerPreset } from './banner-prompt.js';

/**
 * 生成画像を用途の指定寸法へ整える（R120）。
 *
 * 画像生成APIが受け付ける大きさは3種類（1024x1024・1536x1024・1024x1536）
 * だけなので、生成後に用途（13）の指定寸法へ Cloudflare Images binding
 * （`env.CF_IMAGES.input(...).transform({ width, height, fit }).output(...)`）
 * で `fit: 'cover'` 整形する。寸法の正本は `BANNER_PRESETS`
 *（`banner-prompt.ts`）の `targetWidth` / `targetHeight` で、ここに
 * 2つ目の表は作らない。
 *
 * binding が無い環境（手元・試験）では変換を飛ばして元の画像をそのまま
 * 返し、`resized: false` にする。呼び出し側は保存を止めず、画面に
 * 「大きさの調整は検証環境で確認」と出す（R120 のオーナー決定 2026-09-28）。
 */

export const BANNER_CROP_POSITIONS = ['center', 'top', 'bottom'] as const;

/** 切り抜きの位置。cover で切るときに残す側。 */
export type BannerCropPosition = (typeof BANNER_CROP_POSITIONS)[number];

export function isBannerCropPosition(value: unknown): value is BannerCropPosition {
  return value === 'center' || value === 'top' || value === 'bottom';
}

/**
 * run の要求から切り抜き位置を読む。無ければ中央。
 * 中央・上・下以外は受け付けず、呼び出し側で400で断つための null を返す。
 */
export function resolveBannerCropPosition(raw: unknown): BannerCropPosition | null {
  if (raw === undefined || raw === null || raw === '') return 'center';
  return isBannerCropPosition(raw) ? raw : null;
}

/**
 * Cloudflare Images binding のうち、ここが使う最小の形。
 * `Env` は本物の `ImagesBinding` を持つ（`index.ts`）。構造的部分型で
 * 受けられるので、workers-types の版が上がってもここは変えない。
 */
export interface BannerImagesBinding {
  input(stream: ReadableStream<Uint8Array>): {
    transform(opts: { width: number; height: number; fit: 'cover'; gravity: BannerCropPosition }): {
      output(opts: { format: 'image/jpeg' }): Promise<{ image(): ReadableStream<Uint8Array> }>;
    };
  };
}

export interface BannerResizeResult {
  /** R2 へ保存する中身。 */
  bytes: Uint8Array;
  /** 保存する画像の幅・高さ。整形できたら用途の指定寸法（`media` と同じく null 許容）。 */
  width: number | null;
  height: number | null;
  /** 用途の指定寸法へ整形できたか。binding が無い・失敗時は false。 */
  resized: boolean;
}

function toStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  // slice の返りは共有バッファ扱いのため、そのままでは Blob に渡せない。複写する。
  const copy = Uint8Array.from(bytes);
  return new Blob([copy.buffer as ArrayBuffer]).stream();
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * 生成した画像を用途の指定寸法へ整える。
 *
 * - binding が無い（`null` / `undefined`）: 変換を飛ばして元を返す。
 * - 変換に失敗（対応外の形式など）: 生成自体は無駄にしないため元を返す。
 *   どちらも `resized: false` で分かる。幅・高さはそのとき実際に保存する
 *   中身の寸法（元のAPI寸法）を返すので、DB の記録と実体は一致する。
 */
export async function resizeBannerToPreset(
  bytes: Uint8Array,
  preset: BannerPreset,
  crop: BannerCropPosition,
  images: BannerImagesBinding | null | undefined,
): Promise<BannerResizeResult> {
  const apiMatch = /^(\d+)x(\d+)$/.exec(preset.apiSize);
  const fallbackWidth = apiMatch ? Number(apiMatch[1]) : null;
  const fallbackHeight = apiMatch ? Number(apiMatch[2]) : null;
  const fallback = (): BannerResizeResult => ({
    bytes,
    width: fallbackWidth,
    height: fallbackHeight,
    resized: false,
  });
  if (!images) return fallback();
  try {
    const output = await images
      .input(toStream(bytes))
      .transform({ width: preset.targetWidth, height: preset.targetHeight, fit: 'cover', gravity: crop })
      .output({ format: 'image/jpeg' });
    const resizedBytes = await streamToBytes(output.image());
    if (resizedBytes.byteLength === 0) return fallback();
    return { bytes: resizedBytes, width: preset.targetWidth, height: preset.targetHeight, resized: true };
  } catch (error) {
    console.warn('banner resize skipped:', error instanceof Error ? error.message : error);
    return fallback();
  }
}
