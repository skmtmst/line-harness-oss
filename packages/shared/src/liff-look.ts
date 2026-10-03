/**
 * LIFF の見た目（M3：設定を残すための型と計算）。
 *
 * 5つの型・店の色の上書き・カレンダーの出し方・空きの点は、ここが正本。
 * 予約（店）と回答フォーム（フォームごと）が同じ型を使う。色の値そのもの
 * （各型の CSS 変数の組）は M2 が持つ。ここが持つのは保存する値と、
 * 「白い字が読みやすいか」の計算だけ。
 */

/** 見た目の型。'line'（LINE らしい）が既定＝今の見た目のまま。 */
export type LiffTheme = 'natural' | 'modern' | 'gentle' | 'night' | 'line';

export const LIFF_THEMES: LiffTheme[] = ['natural', 'modern', 'gentle', 'night', 'line'];

export const LIFF_THEME_DEFAULT: LiffTheme = 'line';

export function normalizeLiffTheme(value: unknown): LiffTheme {
  return typeof value === 'string' && (LIFF_THEMES as string[]).includes(value)
    ? (value as LiffTheme)
    : LIFF_THEME_DEFAULT;
}

/** カレンダーの出し方。'week_first'（週を先に）が既定。 */
export type LiffCalendarMode = 'week_first' | 'month_first' | 'week_only' | 'month_only';

export const LIFF_CALENDAR_MODES: LiffCalendarMode[] = [
  'week_first',
  'month_first',
  'week_only',
  'month_only',
];

export const LIFF_CALENDAR_MODE_DEFAULT: LiffCalendarMode = 'week_first';

export function normalizeLiffCalendarMode(value: unknown): LiffCalendarMode {
  return typeof value === 'string' && (LIFF_CALENDAR_MODES as string[]).includes(value)
    ? (value as LiffCalendarMode)
    : LIFF_CALENDAR_MODE_DEFAULT;
}

/**
 * 見出しの書体。'default' は型に従う。
 * 'serif'＝しっぽり明朝（①ナチュラル）、'maru'＝Zen Maru Gothic（③やさしい）。
 */
export type LiffHeadingFont = 'default' | 'serif' | 'maru' | 'sans';

export const LIFF_HEADING_FONTS: LiffHeadingFont[] = ['default', 'serif', 'maru', 'sans'];

export const LIFF_HEADING_FONT_DEFAULT: LiffHeadingFont = 'default';

export function normalizeLiffHeadingFont(value: unknown): LiffHeadingFont {
  return typeof value === 'string' && (LIFF_HEADING_FONTS as string[]).includes(value)
    ? (value as LiffHeadingFont)
    : LIFF_HEADING_FONT_DEFAULT;
}

/**
 * #rrggbb の形か（店の色の上書き・null は「型の色」）。
 * 形が違う値は 'invalid' を返す（保存口が 400 で断るため）。
 */
export function normalizeLiffColor(value: unknown): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : 'invalid';
}

/**
 * ④夜の決まった色（オーナー決定・絵の色見本どおり）。黒は使わない。
 * 管理画面の型の選択肢で深い紺の見本として使う。描画そのものは M2。
 */
export const LIFF_NIGHT_COLORS = {
  ground: '#0f1c33',
  surface: '#172a47',
  border: '#27406a',
  muted: '#a9b8d0',
  text: '#f2f5fa',
  gold: '#c9a96a',
} as const;

/** ①ナチュラルの主の色（絵の色見本どおり）。 */
export const LIFF_NATURAL_PRIMARY = '#123d2f';

/** 管理画面の型の選択肢に出す言葉。色の見本は絵にあるものだけ付ける。 */
export const LIFF_THEME_META: Record<LiffTheme, { label: string; note: string; swatch: string | null }> = {
  natural: { label: 'ナチュラル', note: '生成り・しっぽり明朝・深い緑', swatch: LIFF_NATURAL_PRIMARY },
  modern: { label: 'モダン', note: 'すっきりした今ふうの見た目', swatch: null },
  gentle: { label: 'やさしい', note: 'Zen Maru Gothic・テラコッタ', swatch: null },
  night: { label: '夜', note: '深い紺（黒は使わない）', swatch: LIFF_NIGHT_COLORS.ground },
  line: { label: 'LINE らしい', note: '今の見た目のまま', swatch: '#03873a' },
};

/** カレンダーの出し方の選択肢に出す言葉。 */
export const LIFF_CALENDAR_MODE_META: Record<LiffCalendarMode, { label: string }> = {
  week_first: { label: '週を先に（既定）' },
  month_first: { label: '月を先に' },
  week_only: { label: '週だけ' },
  month_only: { label: '月だけ' },
};

/** 見出しの書体の選択肢に出す言葉。 */
export const LIFF_HEADING_FONT_META: Record<LiffHeadingFont, { label: string }> = {
  default: { label: '型に従う' },
  serif: { label: 'しっぽり明朝' },
  maru: { label: 'Zen Maru Gothic' },
  sans: { label: 'ゴシック' },
};

// ---------------------------------------------------------------------------
// 白い字の見やすさ（4.5:1 以上）。足りなければ字を黒にし、濃い候補を出す。
// 保存は止めない（注意だけ出す）。
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 2色のコントラスト比（WCAG と同じ式）。 */
export function liffContrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [light, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

export const LIFF_TEXT_WHITE = '#ffffff';
export const LIFF_TEXT_BLACK = '#1d1d1f';

/**
 * 地の色に対して読みやすい字の色。白で 4.5:1 以上なら白、
 * そうでなければ黒（仕様どおり・保存は止めない）。
 */
export function resolveLiffTextColor(backgroundHex: string): typeof LIFF_TEXT_WHITE | typeof LIFF_TEXT_BLACK {
  if (!/^#[0-9a-f]{6}$/i.test(backgroundHex)) return LIFF_TEXT_WHITE;
  return liffContrastRatio(LIFF_TEXT_WHITE, backgroundHex) >= 4.5
    ? LIFF_TEXT_WHITE
    : LIFF_TEXT_BLACK;
}

/** 地の色を黒寄りに少しずつ濃くした候補（#rrggbb を返す）。 */
function darkenHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * (1 - amount)));
  const toHex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export interface LiffColorCheck {
  /** 地の色に載せる字の色（自動判定）。 */
  textColor: typeof LIFF_TEXT_WHITE | typeof LIFF_TEXT_BLACK;
  /** 白い字との比。 */
  whiteRatio: number;
  /** 白い字で 4.5:1 以上か。 */
  whiteOk: boolean;
  /** 白い字に足りないときの濃い候補（最大2つ・白字で 4.5:1 以上）。空のこともある。 */
  darkerCandidates: string[];
  /** 運用者への注意（保存は止めない）。 */
  warnings: string[];
}

/**
 * 店の色（主の色・地の色）の見やすさを確かめる。
 * null（型の色）のときは確かめようが無いので空の結果を返す。
 */
export function checkLiffColor(backgroundHex: string | null, roleLabel: string): LiffColorCheck {
  const empty: LiffColorCheck = {
    textColor: LIFF_TEXT_WHITE,
    whiteRatio: 0,
    whiteOk: true,
    darkerCandidates: [],
    warnings: [],
  };
  if (!backgroundHex) return empty;
  const whiteRatio = liffContrastRatio(LIFF_TEXT_WHITE, backgroundHex);
  const whiteOk = whiteRatio >= 4.5;
  const textColor = whiteOk ? LIFF_TEXT_WHITE : LIFF_TEXT_BLACK;
  const darkerCandidates: string[] = [];
  if (!whiteOk) {
    for (const amount of [0.25, 0.45]) {
      const candidate = darkenHex(backgroundHex, amount);
      if (liffContrastRatio(LIFF_TEXT_WHITE, candidate) >= 4.5
        && !darkerCandidates.includes(candidate)) {
        darkerCandidates.push(candidate);
      }
      if (darkerCandidates.length >= 2) break;
    }
  }
  const warnings = whiteOk
    ? []
    : [
        `${roleLabel}（${backgroundHex}）に白い字を載せると見やすさが足りません（${whiteRatio.toFixed(1)}:1・目安 4.5:1）。字を黒にします。保存はできます。`,
        ...(darkerCandidates.length > 0
          ? [`白い字のままにするなら、濃い候補があります：${darkerCandidates.join('・')}`]
          : []),
      ];
  return { textColor, whiteRatio, whiteOk, darkerCandidates, warnings };
}

// ---------------------------------------------------------------------------
// 店・フォームごとの見た目の保存形
// ---------------------------------------------------------------------------

/** 店（予約設定）の見た目。色が null は「型の色」。 */
export interface LiffStoreAppearance {
  theme: LiffTheme;
  primaryColor: string | null;
  backgroundColor: string | null;
  headingFont: LiffHeadingFont;
  calendarMode: LiffCalendarMode;
  vacancyDots: boolean;
}

export const LIFF_STORE_APPEARANCE_DEFAULT: LiffStoreAppearance = {
  theme: LIFF_THEME_DEFAULT,
  primaryColor: null,
  backgroundColor: null,
  headingFont: LIFF_HEADING_FONT_DEFAULT,
  calendarMode: LIFF_CALENDAR_MODE_DEFAULT,
  vacancyDots: true,
};

export function normalizeLiffStoreAppearance(value: unknown): LiffStoreAppearance {
  const raw = (value ?? {}) as Partial<Record<keyof LiffStoreAppearance, unknown>>;
  const primary = normalizeLiffColor(raw.primaryColor);
  const background = normalizeLiffColor(raw.backgroundColor);
  return {
    theme: normalizeLiffTheme(raw.theme),
    primaryColor: primary === 'invalid' ? null : primary,
    backgroundColor: background === 'invalid' ? null : background,
    headingFont: normalizeLiffHeadingFont(raw.headingFont),
    calendarMode: normalizeLiffCalendarMode(raw.calendarMode),
    vacancyDots: raw.vacancyDots === undefined ? true : raw.vacancyDots !== false && raw.vacancyDots !== 0,
  };
}

/** 回答フォームごとの見た目。'inherit' は「店の設定に合わせる」（既定）。 */
export type LiffFormAppearanceMode = 'inherit' | 'custom';

export interface LiffFormAppearance {
  mode: LiffFormAppearanceMode;
  theme: LiffTheme;
  primaryColor: string | null;
  backgroundColor: string | null;
  headingFont: LiffHeadingFont;
}

export const LIFF_FORM_APPEARANCE_DEFAULT: LiffFormAppearance = {
  mode: 'inherit',
  theme: LIFF_THEME_DEFAULT,
  primaryColor: null,
  backgroundColor: null,
  headingFont: LIFF_HEADING_FONT_DEFAULT,
};

export function normalizeLiffFormAppearance(value: unknown): LiffFormAppearance {
  const raw = (value ?? {}) as Partial<Record<keyof LiffFormAppearance, unknown>>;
  const primary = normalizeLiffColor(raw.primaryColor);
  const background = normalizeLiffColor(raw.backgroundColor);
  return {
    mode: raw.mode === 'custom' ? 'custom' : 'inherit',
    theme: normalizeLiffTheme(raw.theme),
    primaryColor: primary === 'invalid' ? null : primary,
    backgroundColor: background === 'invalid' ? null : background,
    headingFont: normalizeLiffHeadingFont(raw.headingFont),
  };
}
