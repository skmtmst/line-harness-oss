import type { BannerMode, BannerPersonOption, BannerQuality } from '@line-crm/db';

/**
 * バナー生成の「用途」と、生成AIへ渡す文（プロンプト）の組み立て。
 *
 * 画面では用途（リッチメッセージ、リッチメニュー…）を選ぶだけにし、
 * 画像生成APIに渡せる大きさへの読み替えはここで一か所にまとめる。
 * 生成した文は必ず保存するので、あとから「なぜこの絵になったか」を追える。
 */

export type BannerApiSize = '1024x1024' | '1536x1024' | '1024x1536';

export interface BannerPreset {
  key: string;
  label: string;
  /** 画面で見せる説明。運用者向けの言葉で書く。 */
  note: string;
  /** 画像生成APIに渡す大きさ。 */
  apiSize: BannerApiSize;
  /** 画面と保存用の縦横比の表記。 */
  aspectRatio: '1:1' | '3:2' | '2:3';
  /** LINEでの使い道。プロンプトの媒体説明に使う。 */
  medium: string;
}

export const BANNER_PRESETS: readonly BannerPreset[] = [
  {
    key: 'line_square',
    label: '画像メッセージ・カルーセル（正方形）',
    note: '1040×1040 相当。配信の画像メッセージ、カードタイプメッセージ、リッチメッセージ向け',
    apiSize: '1024x1024',
    aspectRatio: '1:1',
    medium: 'LINE公式アカウントの配信で使う正方形の画像。スマートフォンで縮小表示される',
  },
  {
    key: 'rich_menu_large',
    label: 'リッチメニュー（横長）',
    note: '2500×1686 相当の横長。トーク画面の下部に常時表示されるメニュー画像向け',
    apiSize: '1536x1024',
    aspectRatio: '3:2',
    medium: 'LINEのトーク画面の下に常時表示されるリッチメニュー用の横長画像。ボタンとして押される領域を意識した、整理された構図',
  },
  {
    key: 'landscape',
    label: '横長バナー（OGP・サムネイル）',
    note: 'リンク先のOGP画像、動画サムネイル、Web用バナー向け',
    apiSize: '1536x1024',
    aspectRatio: '3:2',
    medium: 'Webページのシェア画像やサムネイルとして使う横長のバナー',
  },
  {
    key: 'portrait',
    label: '縦長（ストーリー・LINE VOOM）',
    note: 'LINE VOOM やストーリー、縦型のクーポン画像向け',
    apiSize: '1024x1536',
    aspectRatio: '2:3',
    medium: 'スマートフォンの縦画面いっぱいに表示される縦長の画像',
  },
] as const;

export function findBannerPreset(key: string | undefined): BannerPreset | null {
  if (!key) return null;
  return BANNER_PRESETS.find((preset) => preset.key === key) ?? null;
}

/**
 * 品質ごとの利用単位。「1単位≒ライト1枚」と説明できるように整数にする。
 * Banas と同じ比率（ライト1・標準3・高精細8）。
 */
export const BANNER_UNITS_BY_QUALITY: Record<BannerQuality, number> = {
  low: 1,
  medium: 3,
  high: 8,
};

export const BANNER_QUALITY_LABELS: Record<BannerQuality, string> = {
  low: 'ライト',
  medium: 'スタンダード',
  high: '高精細',
};

export const BANNER_MAX_TEXT_LINES = 6;
export const BANNER_MAX_TEXT_LINE_LENGTH = 40;
export const BANNER_MAX_CUSTOM_PROMPT_LENGTH = 600;
export const BANNER_MAX_FREE_PROMPT_LENGTH = 1200;
export const BANNER_MAX_COUNT = 4;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

export interface BannerPromptInput {
  mode: BannerMode;
  preset: BannerPreset;
  textLines: string[];
  mainColor: string | null;
  subColor: string | null;
  personOption: BannerPersonOption;
  customPrompt: string;
  freePrompt: string;
}

const ROLE_HINTS = ['メインのキャッチコピー', 'サブコピー', '訴求ポイント', '期間・条件', '行動を促す文言（CTA）', '補足'];

/**
 * 画像生成AIへ渡す文を組み立てる。
 *
 * 日本語の文字は「一字一句そのまま」「順番どおり」「読める大きさで」と
 * 何度も念を押す。ここが弱いと、それらしい別の文字に置き換わる。
 */
export function buildBannerPrompt(input: BannerPromptInput): string {
  const parts: string[] = [];

  if (input.mode === 'free') {
    parts.push(input.freePrompt.trim());
    parts.push(`用途: ${input.preset.medium}。`);
  } else {
    parts.push(`${input.preset.medium}のためのプロモーション画像を1枚デザインしてください。`);

    const lines = input.textLines.map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) {
      parts.push('画像の中に、次の日本語テキストを「この順番で」「一字一句そのまま」「誤字なく」大きく読みやすい日本語フォントで配置してください。テキストはこれ以外に一切追加しないでください。');
      lines.forEach((line, index) => {
        const role = ROLE_HINTS[Math.min(index, ROLE_HINTS.length - 1)];
        parts.push(`${index + 1}. 「${line}」（${role}）`);
      });
    } else {
      parts.push('文字は入れないでください。');
    }

    if (input.mainColor) {
      parts.push(`メインカラーは ${input.mainColor} を基調にしてください。`);
    }
    if (input.subColor) {
      parts.push(`アクセントカラーとして ${input.subColor} を組み合わせてください。`);
    }
    parts.push(
      input.personOption === 'with'
        ? '人物を自然に登場させてください（実在の人物や有名人には似せないこと）。'
        : '人物は登場させないでください。',
    );
    if (input.customPrompt.trim()) {
      parts.push(`追加の指示: ${input.customPrompt.trim()}`);
    }
  }

  parts.push(
    [
      '禁止事項:',
      '透かし・署名・ロゴの捏造・架空の会社名・QRコードを入れない。',
      '指定していない英語や意味のない文字列を入れない。',
      '文字が画像の端で切れないよう、余白を十分に取る。',
      'スマートフォンで縮小表示しても読めるコントラストにする。',
    ].join(' '),
  );

  return parts.join('\n');
}

export interface BannerRequestValidation {
  ok: boolean;
  error?: string;
  value?: {
    mode: BannerMode;
    preset: BannerPreset;
    textLines: string[];
    mainColor: string | null;
    subColor: string | null;
    personOption: BannerPersonOption;
    customPrompt: string;
    freePrompt: string;
    quality: BannerQuality;
    count: number;
  };
}

/** 画面から来た生成条件を検査し、扱いやすい形に整える。 */
export function validateBannerRequest(body: Record<string, unknown> | null): BannerRequestValidation {
  if (!body || typeof body !== 'object') return { ok: false, error: '生成条件がありません' };

  const mode: BannerMode = body.mode === 'free' ? 'free' : 'banner';
  const preset = findBannerPreset(typeof body.presetKey === 'string' ? body.presetKey : undefined);
  if (!preset) return { ok: false, error: '用途を選んでください' };

  const quality = body.quality;
  if (quality !== 'low' && quality !== 'medium' && quality !== 'high') {
    return { ok: false, error: '品質はライト・スタンダード・高精細から選んでください' };
  }

  const countRaw = Number(body.count ?? 1);
  if (!Number.isInteger(countRaw) || countRaw < 1 || countRaw > BANNER_MAX_COUNT) {
    return { ok: false, error: `枚数は1〜${BANNER_MAX_COUNT}枚で指定してください` };
  }

  const rawLines = Array.isArray(body.textLines) ? body.textLines : [];
  const textLines = rawLines
    .filter((line): line is string => typeof line === 'string')
    .map((line) => line.trim())
    .filter(Boolean);
  if (textLines.length > BANNER_MAX_TEXT_LINES) {
    return { ok: false, error: `テキストは${BANNER_MAX_TEXT_LINES}行までにしてください` };
  }
  const tooLong = textLines.find((line) => line.length > BANNER_MAX_TEXT_LINE_LENGTH);
  if (tooLong) {
    return { ok: false, error: `1行は${BANNER_MAX_TEXT_LINE_LENGTH}文字までにしてください（「${tooLong.slice(0, 12)}…」）` };
  }

  const mainColor = body.mainColor == null || body.mainColor === '' ? null : body.mainColor;
  if (mainColor !== null && !isHexColor(mainColor)) {
    return { ok: false, error: 'メインカラーは #RRGGBB の形式で指定してください' };
  }
  const subColor = body.subColor == null || body.subColor === '' ? null : body.subColor;
  if (subColor !== null && !isHexColor(subColor)) {
    return { ok: false, error: 'サブカラーは #RRGGBB の形式で指定してください' };
  }

  const personOption: BannerPersonOption = body.personOption === 'with' ? 'with' : 'without';
  const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt.trim() : '';
  if (customPrompt.length > BANNER_MAX_CUSTOM_PROMPT_LENGTH) {
    return { ok: false, error: `追加の指示は${BANNER_MAX_CUSTOM_PROMPT_LENGTH}文字までにしてください` };
  }
  const freePrompt = typeof body.freePrompt === 'string' ? body.freePrompt.trim() : '';
  if (freePrompt.length > BANNER_MAX_FREE_PROMPT_LENGTH) {
    return { ok: false, error: `プロンプトは${BANNER_MAX_FREE_PROMPT_LENGTH}文字までにしてください` };
  }

  if (mode === 'free' && !freePrompt) {
    return { ok: false, error: '作りたい画像の説明を入力してください' };
  }
  if (mode === 'banner' && textLines.length === 0 && !customPrompt) {
    return { ok: false, error: 'バナーに入れるテキストか、追加の指示を入力してください' };
  }

  return {
    ok: true,
    value: {
      mode,
      preset,
      textLines,
      mainColor: mainColor as string | null,
      subColor: subColor as string | null,
      personOption,
      customPrompt,
      freePrompt,
      quality,
      count: countRaw,
    },
  };
}
