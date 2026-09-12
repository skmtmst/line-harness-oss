import type { BannerMode, BannerPersonOption, BannerQuality } from '@line-crm/db';

/**
 * バナー生成の「用途」と、生成AIへ渡す文（プロンプト）の組み立て。
 *
 * 画面では用途（リッチメッセージ、リッチメニュー…）を選ぶだけにし、
 * 画像生成APIに渡せる大きさへの読み替えはここで一か所にまとめる。
 * 生成した文は必ず保存するので、あとから「なぜこの絵になったか」を追える。
 */

export type BannerApiSize = '1024x1024' | '1536x1024' | '1024x1536';
export type BannerPresetGroup = 'line' | 'sns';

export interface BannerPreset {
  key: string;
  group: BannerPresetGroup;
  label: string;
  /** 画面で見せる説明。運用者向けの言葉で書く。 */
  note: string;
  /** 画像生成APIに渡す大きさ。 */
  apiSize: BannerApiSize;
  /** 実際に使う場所の規格（幅×高さ）。将来この大きさへ整形する。 */
  targetWidth: number;
  targetHeight: number;
  /** 画面と保存用の縦横比の表記。 */
  aspectRatio: string;
  /** LINE や SNS での使い道。プロンプトの媒体説明に使う。 */
  medium: string;
}

/**
 * 用途の一覧。LINE の中で使う画像規格と、主な SNS の規格を網羅する。
 * 画像生成APIが受け付ける大きさは3種類なので、いちばん近いものを選び、
 * 規格の大きさへの整形は後続の工程で行う。
 */
export const BANNER_PRESETS: readonly BannerPreset[] = [
  { key: 'line_rich_message', group: 'line', label: 'リッチメッセージ', note: '1040×1040。トークに大きく出る正方形の画像', apiSize: '1024x1024', targetWidth: 1040, targetHeight: 1040, aspectRatio: '1:1', medium: 'LINE公式アカウントのリッチメッセージ用の正方形画像。トーク画面いっぱいに表示され、押すとリンクへ飛ぶ' },
  { key: 'line_image_message', group: 'line', label: '画像メッセージ・クーポン', note: '1040×1040。画像だけを送るメッセージやクーポンの絵', apiSize: '1024x1024', targetWidth: 1040, targetHeight: 1040, aspectRatio: '1:1', medium: 'LINE公式アカウントで送る正方形の画像メッセージ。スマートフォンで縮小表示される' },
  { key: 'line_card', group: 'line', label: 'カードタイプ・カルーセル', note: '1200×795（1.51:1）。横にめくれるカードの画像', apiSize: '1536x1024', targetWidth: 1200, targetHeight: 795, aspectRatio: '1.51:1', medium: 'LINEのカードタイプメッセージ（カルーセル）の各カードに載せる横長画像。下に文字と押しボタンが付く' },
  { key: 'line_rich_menu_large', group: 'line', label: 'リッチメニュー（大）', note: '2500×1686。トーク画面の下に常時表示されるメニュー', apiSize: '1536x1024', targetWidth: 2500, targetHeight: 1686, aspectRatio: '3:2', medium: 'LINEのトーク画面の下に常時表示されるリッチメニュー用の横長画像。ボタンとして押される区画を意識した、整理された構図' },
  { key: 'line_rich_menu_small', group: 'line', label: 'リッチメニュー（小）', note: '2500×843。高さが半分のメニュー', apiSize: '1536x1024', targetWidth: 2500, targetHeight: 843, aspectRatio: '3:1', medium: 'LINEのリッチメニュー（小）用の細長い横長画像。重要な文字と絵は上下の中央の帯に収める' },
  { key: 'line_voom_square', group: 'line', label: 'LINE VOOM（正方形）', note: '1080×1080。VOOM の投稿画像', apiSize: '1024x1024', targetWidth: 1080, targetHeight: 1080, aspectRatio: '1:1', medium: 'LINE VOOM に投稿する正方形の画像' },
  { key: 'line_voom_vertical', group: 'line', label: 'LINE VOOM（縦長）', note: '1080×1920。縦いっぱいの投稿', apiSize: '1024x1536', targetWidth: 1080, targetHeight: 1920, aspectRatio: '9:16', medium: 'LINE VOOM の縦長投稿。スマートフォンの縦画面いっぱいに表示される' },
  { key: 'sns_instagram_feed', group: 'sns', label: 'Instagram フィード（正方形）', note: '1080×1080', apiSize: '1024x1024', targetWidth: 1080, targetHeight: 1080, aspectRatio: '1:1', medium: 'Instagram のフィード投稿用の正方形画像' },
  { key: 'sns_instagram_portrait', group: 'sns', label: 'Instagram フィード（縦長）', note: '1080×1350（4:5）', apiSize: '1024x1536', targetWidth: 1080, targetHeight: 1350, aspectRatio: '4:5', medium: 'Instagram のフィード投稿用の縦長画像。重要な文字と絵は上下の中央に収める' },
  { key: 'sns_story', group: 'sns', label: 'ストーリー・リール・TikTok', note: '1080×1920（9:16）', apiSize: '1024x1536', targetWidth: 1080, targetHeight: 1920, aspectRatio: '9:16', medium: 'Instagram ストーリー・リール、TikTok 用の縦長画像。上下の端はアプリの操作部に隠れるので、重要な文字は中央に収める' },
  { key: 'sns_x_post', group: 'sns', label: 'X（旧Twitter）投稿', note: '1200×675（16:9）', apiSize: '1536x1024', targetWidth: 1200, targetHeight: 675, aspectRatio: '16:9', medium: 'X（旧Twitter）の投稿に添える横長画像' },
  { key: 'sns_ogp', group: 'sns', label: 'OGP・Facebook リンク画像', note: '1200×630（1.91:1）。リンクを共有したときに出る画像', apiSize: '1536x1024', targetWidth: 1200, targetHeight: 630, aspectRatio: '1.91:1', medium: 'Webページを SNS で共有したときに出る横長のリンク画像（OGP）' },
  { key: 'sns_youtube_thumbnail', group: 'sns', label: 'YouTube サムネイル', note: '1280×720（16:9）', apiSize: '1536x1024', targetWidth: 1280, targetHeight: 720, aspectRatio: '16:9', medium: 'YouTube の動画サムネイル。小さく表示されても読める大きな文字と強い対比' },
] as const;

export function findBannerPreset(key: string | undefined): BannerPreset | null {
  if (!key) return null;
  return BANNER_PRESETS.find((preset) => preset.key === key) ?? null;
}

/**
 * 生成の品質は運用者に選ばせない（ライト／スタンダード／高精細の選択は素人には判断できない）。
 * 日本語の文字が崩れにくい「スタンダード」に固定する。変えるときは環境変数で切り替える。
 */
export const BANNER_FIXED_QUALITY: BannerQuality = 'medium';

export function resolveBannerQuality(raw: string | undefined): BannerQuality {
  return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : BANNER_FIXED_QUALITY;
}

export const BANNER_MAX_TEXT_LINES = 6;
export const BANNER_MAX_TEXT_LINE_LENGTH = 40;
export const BANNER_MAX_CUSTOM_PROMPT_LENGTH = 600;
export const BANNER_MAX_FREE_PROMPT_LENGTH = 1200;
/** 一度に作れる枚数。暴走防止の安全弁の1つ。 */
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

  const native = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' }[input.preset.aspectRatio] === input.preset.apiSize;
  if (!native) {
    parts.push(`最終的に ${input.preset.aspectRatio} に切り抜いて使うので、重要な文字と主役は画像の中央に収め、端にはあまり置かないでください。`);
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
    count: number;
  };
}

/** 画面から来た生成条件を検査し、扱いやすい形に整える。 */
export function validateBannerRequest(body: Record<string, unknown> | null): BannerRequestValidation {
  if (!body || typeof body !== 'object') return { ok: false, error: '生成条件がありません' };

  const mode: BannerMode = body.mode === 'free' ? 'free' : 'banner';
  const preset = findBannerPreset(typeof body.presetKey === 'string' ? body.presetKey : undefined);
  if (!preset) return { ok: false, error: '用途を選んでください' };

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
      count: countRaw,
    },
  };
}
