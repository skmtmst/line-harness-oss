import { describe, expect, it, vi } from 'vitest';
import { BANNER_PRESETS, type BannerPreset } from './banner-prompt.js';
import {
  isBannerCropPosition,
  resolveBannerCropPosition,
  resizeBannerToPreset,
  type BannerCropPosition,
  type BannerImagesBinding,
} from './banner-resize.js';

/** Cloudflare Images binding の代わり。渡された条件を記録し、固定の中身を返す。 */
function fakeImages() {
  const calls: Array<{ width: number; height: number; fit: string; gravity: string }> = [];
  const output = vi.fn(async () => ({ image: () => new Blob(['resized']).stream() }));
  const transform = vi.fn((opts: { width: number; height: number; fit: 'cover'; gravity: BannerCropPosition }) => {
    calls.push({ ...opts });
    return { output };
  });
  const binding = { input: vi.fn(() => ({ transform })) } as unknown as BannerImagesBinding;
  return { binding, calls, transform, output };
}

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function streamText(bytes: Uint8Array): Promise<string> {
  return new TextDecoder().decode(bytes);
}

describe('resolveBannerCropPosition', () => {
  it('無指定は中央になる', () => {
    expect(resolveBannerCropPosition(undefined)).toBe('center');
    expect(resolveBannerCropPosition(null)).toBe('center');
    expect(resolveBannerCropPosition('')).toBe('center');
  });

  it('中央・上・下だけ受け付ける', () => {
    expect(resolveBannerCropPosition('center')).toBe('center');
    expect(resolveBannerCropPosition('top')).toBe('top');
    expect(resolveBannerCropPosition('bottom')).toBe('bottom');
    expect(resolveBannerCropPosition('left')).toBeNull();
    expect(resolveBannerCropPosition('auto')).toBeNull();
    expect(isBannerCropPosition('left')).toBe(false);
  });
});

describe('resizeBannerToPreset', () => {
  it('13用途すべてを指定寸法・fit=cover で整える', async () => {
    expect(BANNER_PRESETS).toHaveLength(13);
    for (const preset of BANNER_PRESETS) {
      const { binding, calls } = fakeImages();
      const result = await resizeBannerToPreset(toBytes(`source-${preset.key}`), preset, 'center', binding);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        width: preset.targetWidth,
        height: preset.targetHeight,
        fit: 'cover',
        gravity: 'center',
      });
      expect(result).toMatchObject({ width: preset.targetWidth, height: preset.targetHeight, resized: true });
      expect(await streamText(result.bytes)).toBe('resized');
    }
  });

  it('切り抜きの位置を上・下・中央で渡せる', async () => {
    const preset = BANNER_PRESETS.find((p) => p.key === 'sns_instagram_portrait')!;
    for (const crop of ['top', 'center', 'bottom'] as const) {
      const { binding, calls } = fakeImages();
      const result = await resizeBannerToPreset(toBytes('x'), preset, crop, binding);
      expect(calls[0].gravity).toBe(crop);
      expect(result.resized).toBe(true);
    }
  });

  it.each([
    ['line_rich_message', 1040, 1040],
    ['line_rich_menu_small', 2500, 843],
    ['sns_instagram_portrait', 1080, 1350],
    ['sns_story', 1080, 1920],
    ['sns_youtube_thumbnail', 1280, 720],
  ] as Array<[string, number, number]>)('用途 %s は %ix%i になる', async (key, width, height) => {
    const preset = BANNER_PRESETS.find((p) => p.key === key) as BannerPreset;
    const { binding } = fakeImages();
    const result = await resizeBannerToPreset(toBytes('x'), preset, 'center', binding);
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
  });

  it('binding が無い環境では元の画像をそのまま返し、記録もAPI寸法のままにする', async () => {
    const preset = BANNER_PRESETS.find((p) => p.key === 'line_rich_menu_small')!;
    const source = toBytes('original');
    for (const missing of [null, undefined]) {
      const result = await resizeBannerToPreset(source, preset, 'center', missing);
      expect(result.resized).toBe(false);
      expect(result.bytes).toBe(source);
      // 実体は生成APIのまま（1536×1024）なので、記録もそれに合わせる
      expect(result.width).toBe(1536);
      expect(result.height).toBe(1024);
    }
  });

  it('変換に失敗しても生成を捨てず、元を返して resized=false にする', async () => {
    const preset = BANNER_PRESETS.find((p) => p.key === 'sns_story')!;
    const failing = {
      input: () => {
        throw new Error('unsupported input');
      },
    } as unknown as BannerImagesBinding;
    const source = toBytes('original');
    const result = await resizeBannerToPreset(source, preset, 'top', failing);
    expect(result.resized).toBe(false);
    expect(result.bytes).toBe(source);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1536);
  });
});
