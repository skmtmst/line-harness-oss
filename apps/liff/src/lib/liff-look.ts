/**
 * LIFF の見た目の型 (V8.pen 修正案 L-2・L-3。M2)。
 * 5つの型は CSS 変数の組で持ち (index.css の [data-liff-theme])、
 * 店の色はその上に重ねる。型を替えても店の色は残る。
 *
 * 設定の読み口は /api/liff/booking/settings (M3 が型・店の色・
 * カレンダーの出し方・空きの点を足す)。無い欄は既定に倒すので、
 * M3 の適用前も今の見た目 (⑤ LINE らしい) のまま動く。
 */

/** 見た目の型。⑤ LINE らしい (今の見た目) が既定。 */
export const LIFF_THEMES = ['natural', 'modern', 'gentle', 'night', 'line'] as const;
export type LiffThemeId = (typeof LIFF_THEMES)[number];

/** カレンダーの出し方。週を先に開くのが既定。 */
export const LIFF_CALENDAR_MODES = [
  'week-first',
  'month-first',
  'week-only',
  'month-only',
] as const;
export type LiffCalendarMode = (typeof LIFF_CALENDAR_MODES)[number];

/** 店が選ぶ見出しの書体。 */
export const LIFF_HEADING_FONTS = ['default', 'mincho', 'marugothic', 'sans'] as const;
export type LiffHeadingFont = (typeof LIFF_HEADING_FONTS)[number];

/** 見出しの書体の重ね (index.css の --liff-font-heading に渡す)。 */
export const HEADING_STACKS: Record<Exclude<LiffHeadingFont, 'default'>, string> = {
  mincho: '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif',
  marugothic: '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", sans-serif',
  sans: '"Inter", "Noto Sans JP", sans-serif',
};

/** API が返す見た目の欄 (M3 が足す)。来ない欄があってもよい。 */
export interface LiffLookApiSettings {
  liff_theme?: unknown;
  shop_primary_color?: unknown;
  shop_background_color?: unknown;
  shop_heading_font?: unknown;
  liff_calendar_mode?: unknown;
  liff_vacancy_dots?: unknown;
  /** 旧い欄。liff_calendar_mode が無いときだけ最初の形に使う。 */
  liff_date_view?: unknown;
}

/** 画面が使う見た目 (既定まで倒した形)。 */
export interface LiffLook {
  theme: LiffThemeId;
  primaryColor: string | null;
  backgroundColor: string | null;
  headingFont: LiffHeadingFont;
  calendarMode: LiffCalendarMode;
  vacancyDots: boolean;
}

export const DEFAULT_LOOK: LiffLook = {
  theme: 'line',
  primaryColor: null,
  backgroundColor: null,
  headingFont: 'default',
  calendarMode: 'week-first',
  vacancyDots: true,
};

function isTheme(value: unknown): value is LiffThemeId {
  return typeof value === 'string' && (LIFF_THEMES as readonly string[]).includes(value);
}

function isCalendarMode(value: unknown): value is LiffCalendarMode {
  return (
    typeof value === 'string' && (LIFF_CALENDAR_MODES as readonly string[]).includes(value)
  );
}

function isHeadingFont(value: unknown): value is LiffHeadingFont {
  return (
    typeof value === 'string' && (LIFF_HEADING_FONTS as readonly string[]).includes(value)
  );
}

/** #rgb・#rrggbb だけ受け、小文字の #rrggbb に直す。それ以外は null。 */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  const h = m[1].toLowerCase();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `#${full}`;
}

/**
 * 設定を画面の形に倒す。変な値は既定に戻し、止めない。
 * 型を選んでいない店は ⑤ LINE らしい＝今の見た目のまま。
 */
export function resolveLook(raw: LiffLookApiSettings | null | undefined): LiffLook {
  if (!raw) return { ...DEFAULT_LOOK };
  let calendarMode: LiffCalendarMode = DEFAULT_LOOK.calendarMode;
  if (isCalendarMode(raw.liff_calendar_mode)) {
    calendarMode = raw.liff_calendar_mode;
  } else if (raw.liff_date_view === 'calendar') {
    calendarMode = 'month-first';
  } else if (raw.liff_date_view === 'list') {
    calendarMode = 'week-first';
  }
  return {
    theme: isTheme(raw.liff_theme) ? raw.liff_theme : DEFAULT_LOOK.theme,
    primaryColor: normalizeHex(raw.shop_primary_color),
    backgroundColor: normalizeHex(raw.shop_background_color),
    headingFont: isHeadingFont(raw.shop_heading_font)
      ? raw.shop_heading_font
      : DEFAULT_LOOK.headingFont,
    calendarMode,
    // 0・'0'・false だけ消す。来なければ付ける (今どおり)。
    vacancyDots: raw.liff_vacancy_dots === false ||
      raw.liff_vacancy_dots === 0 ||
      raw.liff_vacancy_dots === '0'
      ? false
      : true,
  };
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** #rrggbb を 0〜255 に割る。変な値は null。 */
export function hexToRgb(hex: string): Rgb | null {
  const full = normalizeHex(hex);
  if (!full) return null;
  return {
    r: parseInt(full.slice(1, 3), 16),
    g: parseInt(full.slice(3, 5), 16),
    b: parseInt(full.slice(5, 7), 16),
  };
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG の相対輝度 (0〜1)。 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

/** 2色の見やすさの比 (1〜21。WCAG の contrast ratio)。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 白 (#ffffff) との比。主の色の上の白字が読めるかの判定に使う。 */
export function contrastWithWhite(bgHex: string): number | null {
  const bg = hexToRgb(bgHex);
  if (!bg) return null;
  return contrastRatio(bg, { r: 255, g: 255, b: 255 });
}

/**
 * 主の色の上の字。白との比が 4.5 以上なら白、足りなければ濃い字。
 * 保存は止めない。LIFF 側で字だけ替える (見やすさの自動の確かめ)。
 * 変な色が来たら白のまま (今どおり)。
 */
export function textOnColor(
  bgHex: string,
  light = '#ffffff',
  dark = '#1d1d1f',
): string {
  const ratio = contrastWithWhite(bgHex);
  if (ratio === null) return light;
  return ratio >= 4.5 ? light : dark;
}

/** 白に寄せる (主の色から選んだときの薄い地に使う)。ratio は 0〜1。 */
export function soften(hex: string, ratio = 0.9): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  const toHex = (c: number) => mix(c).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * 店の色の重ね (包みの div の style に渡す CSS 変数)。
 * 型の変数の上に置くので、型を替えても店の色は残る。
 */
export function lookStyleVars(look: LiffLook): Record<string, string> {
  const vars: Record<string, string> = {};
  if (look.primaryColor) {
    vars['--color-liff-primary'] = look.primaryColor;
    const soft = soften(look.primaryColor);
    if (soft) vars['--color-liff-soft'] = soft;
    vars['--liff-on-primary'] = textOnColor(look.primaryColor);
  }
  if (look.backgroundColor) {
    vars['--color-canvas'] = look.backgroundColor;
  }
  if (look.headingFont !== 'default') {
    vars['--liff-font-heading'] = HEADING_STACKS[look.headingFont];
  }
  return vars;
}
