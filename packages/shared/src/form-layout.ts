import { jstCalendar as japanCalendar } from './jst-datetime.js';
import type {
  FormInputType, FormInputFormat, FormInputBlock, FormBlock, FormOptions,
  FormTheme, FormLayout, FormFieldCompat, FormAddressValue, FormDecorationBlock,
} from './types/form-layout.js';
export type {
  FormInputType, FormInputFormat, FormDestinations, FormInputLimit, FormInputBlock,
  FormFileAnswer, FormDecorationBlock, FormBlock, FormSection, FormOptions,
  CustomerDesignPreset, FormFontFamily, FormCornerRadius, FormTheme, FormLayout,
  FormFieldCompat, FormAddressValue,
} from './types/form-layout.js';
import { CUSTOMER_DESIGN_IDS } from './form-design-presets.js';
export { CUSTOMER_DESIGN_IDS } from './form-design-presets.js';
import type { FormChoice, FormAction } from './form-choice-types.js';
export type { FormChoice, FormAction } from './form-choice-types.js';
import type { FormBookingValue } from './form-booking-types.js';
export type { FormBookingConfig, FormBookingValue } from './form-booking-types.js';
import { isCalendarDateString } from './form-calendar-date.js'
export { isCalendarDateString } from './form-calendar-date.js'
import { FIXED_FRIEND_FIELDS, ageFromBirthday, validateAllergyValues, type FixedFriendFieldKey } from "./fixed-friend-fields.js";

/** 保存するブロックの許可一覧。画面・Workerで同じ一覧を使う。 */
export const FORM_INPUT_TYPES: readonly FormInputType[] = [
  "text", "textarea", "radio", "checkbox", "select", "file", "date", "prefecture", "rating", "address", "booking",
];
const FORM_BLOCK_KINDS = ["input", "image", "heading", "text", "button"];

/** 旧い fields だけを受け取る口でも未知の種類を通さない。 */
export function legacyFormFieldTypeError(fields: unknown): string | null {
  if (!Array.isArray(fields)) return "入力欄の形を確認してください";
  const allowed = [...FORM_INPUT_TYPES, "email", "tel", "number", "heading"];
  return fields.some(field => !field || typeof field !== "object" ||
    !allowed.includes(String((field as Record<string, unknown>).type ?? "text")))
    ? "この入力欄の種類は保存できません" : null;
}

/** A block accepting identity documents protects every attachment at the strictest level. */
export function formFileKinds(block: FormInputBlock): ("image" | "pdf" | "identity")[] {
  return block.fileKinds ?? [block.fileKind ?? "image"];
}
export function formFileKind(block: FormInputBlock): "image" | "pdf" | "identity" {
  const kinds = formFileKinds(block);
  return kinds.includes("identity") ? "identity" : kinds.includes("image") ? "image" : "pdf";
}

export const FORM_DOCUMENT_SCAN_NOTE = '危ないファイルの検査は内蔵の検査が標準です。外部の検査は設定した店だけで行います。';

/** 既存のメール・電話・住所・本名のブロックも同じ基本欄へ保存する。 */
export function fixedFieldForBlock(block: FormInputBlock): FixedFriendFieldKey | undefined {
  if (block.fixedField) return block.fixedField;
  if (block.destinations?.realName) return "name";
  if (block.type === "address") return "address";
  if (block.type === "text" && block.limit?.format === "email") return "email";
  if (block.type === "text" && block.limit?.format === "tel") return "tel";
  return undefined;
}

// ---------------------------------------------------------------------------
// 既定値
// ---------------------------------------------------------------------------

export const FORM_OPTIONS_DEFAULT: FormOptions = {
  thanksUrl: null,
  thanksText: "ご回答ありがとうございました。",
  restorePrevious: false,
  pageTitle: null,
  submitLabel: "送信する",
  prevLabel: "前へ",
  nextLabel: "次へ",
  sectionHeader: "pageNumber",
  confirmDialog: { enabled: false },
  deadline: { enabled: false },
  oncePerFriend: { enabled: false },
  totalLimit: { enabled: false },
  afterActions: [],
};

export const FORM_THEME_DEFAULT: FormTheme = {
  main: "#008f3d",
  sub: "#e8f8ee",
  accent: "#175cd3",
  error: "#e5484d",
  text: "#1d1d1f",
  fontFamily: "sans",
  cornerRadius: "medium",
  backgroundImageUrl: null,
};

/**
 * 一意なIDを作る。
 *
 * `crypto.randomUUID` は Workers・ブラウザの両方にあるが、古い環境や
 * テストの偽物では欠けることがある。落ちると保存そのものが止まるので、
 * 手前で受け止める。
 */
export function newBlockId(prefix = "b"): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

export function emptyLayout(): FormLayout {
  return {
    version: 2,
    header: [],
    sections: [{ id: newBlockId("s"), name: "セクション1", blocks: [] }],
    options: { ...FORM_OPTIONS_DEFAULT },
  };
}

/**
 * 回答が「未回答」か。空文字・空白だけの文字列・null/undefined・
 * 中身が空の配列をすべて未回答として扱う。
 * 公開側の必須判定と、送信側の「未回答なら登録先を更新しない」判定が
 * 同じ意味を使うために1箇所に置く。
 */
export function isFormAnswerEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) {
    return value.every(
      (item) => item === undefined || item === null || String(item).trim() === "",
    );
  }
  if (typeof value === "object") {
    const entries = Object.values(value as Record<string, unknown>);
    if (entries.length === 0) return true;
    return entries.every(
      (item) => item === undefined || item === null || String(item).trim() === "",
    );
  }
  return false;
}

/** 「その他」の選択肢がある設問で、回答値が自由記入の値（どの選択肢ラベルでもない文字列）か。 */
export function isOtherFreeText(block: FormInputBlock, value: string): boolean {
  if (value === "") return false;
  if (!(block.choices ?? []).some((choice) => choice.isOther)) return false;
  return !(block.choices ?? []).some((choice) => choice.label === value);
}

/**
 * 選択肢が回答で選ばれたか。ラベル一致に加えて、
 * 「その他」の選択肢は自由記入の値でも選ばれた扱いにする。
 * 分岐・動作・定員の判定が同じ一致ルールを使うための共有ヘルパー。
 */
export function formChoiceIsSelected(
  block: FormInputBlock,
  choice: FormChoice,
  selected: string[],
): boolean {
  if (selected.includes(choice.label)) return true;
  if (!choice.isOther) return false;
  return selected.some((value) => isOtherFreeText(block, value));
}

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

export function isInputBlock(block: FormBlock): block is FormInputBlock {
  return block.kind === "input";
}

/** 選択肢を持つ入力欄か。 */
export function hasChoices(block: FormInputBlock): boolean {
  return (
    block.type === "radio" ||
    block.type === "checkbox" ||
    block.type === "select"
  );
}

/** ヘッダとすべてのセクションから、入力欄だけを出る順に取り出す。 */
export function collectInputs(layout: FormLayout): FormInputBlock[] {
  const out: FormInputBlock[] = [];
  for (const block of layout.header) {
    if (isInputBlock(block)) out.push(block);
  }
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (isInputBlock(block)) out.push(block);
    }
  }
  return out;
}

/**
 * 互換用の `fields` を作る。
 *
 * 種類は昔からの呼び名へ寄せる（textarea / select / date …）。
 * 昔の値しか知らない画面が、この配列を読んでも壊れないようにするため。
 */
export function layoutToFields(layout: FormLayout): FormFieldCompat[] {
  return collectInputs(layout).map((block) => {
    const compat: FormFieldCompat = {
      name: block.name,
      label: block.label,
      type: compatType(block),
      required: block.required ?? false,
    };
    if (hasChoices(block) && block.choices?.length) {
      compat.options = block.choices.map((c) => c.label);
    }
    if (block.placeholder) compat.placeholder = block.placeholder;
    if (block.description) compat.description = block.description;
    const firstField = block.destinations?.friendFieldIds?.[0];
    if (firstField) compat.friendFieldId = firstField;
    return compat;
  });
}

function compatType(block: FormInputBlock): string {
  if (block.type === "text") {
    // 入力制限を、昔の type 名へ寄せる。回答一覧の見え方が変わらない。
    switch (block.limit?.format) {
      case "email":
        return "email";
      case "tel":
        return "tel";
      case "integer":
        return "number";
      default:
        return "text";
    }
  }
  if (block.type === "prefecture") return "select";
  if (block.type === "file") return "file";
  if (block.type === "rating") return "rating";
  if (block.type === "address") return "address";
  if (block.type === "booking") return "booking";
  return block.type;
}

/**
 * 昔の `fields` を layout へ持ち上げる。
 *
 * layout がまだ無いフォームを編集画面で開いたときに使う。**保存するまで
 * DBは変わらない**ので、開いただけで壊れることはない。
 */
export function fieldsToLayout(fields: unknown): FormLayout {
  const layout = emptyLayout();
  if (!Array.isArray(fields)) return layout;

  layout.sections[0].blocks = fields.map((raw, index) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const type = String(f.type ?? "text");
    const label = String(f.label ?? f.name ?? `項目${index + 1}`);

    if (type === "heading") {
      return { id: newBlockId(), kind: "heading", text: label, level: 2 };
    }

    const block: FormInputBlock = {
      id: newBlockId(),
      kind: "input",
      type: liftType(type),
      name: String(f.name ?? `field_${index + 1}`),
      label,
      required: Boolean(f.required),
      hidden: Boolean(f.hidden),
    };
    if (typeof f.description === "string" && f.description) {
      block.description = f.description;
    }
    if (typeof f.placeholder === "string" && f.placeholder) {
      block.placeholder = f.placeholder;
    }
    if (typeof f.defaultValue === "string" && f.defaultValue) {
      block.defaultValue = f.defaultValue;
    }
    if (typeof f.friendFieldId === "string" && f.friendFieldId) {
      block.destinations = { friendFieldIds: [f.friendFieldId] };
    }
    const format = liftFormat(type);
    if (format) block.limit = { format };
    if (Array.isArray(f.options) && f.options.length) {
      block.choiceMode = "tag";
      block.choices = f.options.map((opt) => ({
        id: newBlockId("c"),
        label: String(opt),
      }));
    }
    return block;
  });

  return layout;
}

function liftType(type: string): FormInputType {
  switch (type) {
    case "textarea":
      return "textarea";
    case "select":
      return "select";
    case "radio":
      return "radio";
    case "checkbox":
      return "checkbox";
    case "date":
      return "date";
    case "file":
      return "file";
    case "prefecture":
      return "prefecture";
    case "rating":
      return "rating";
    case "address":
      return "address";
    case "booking":
      return "booking";
    default:
      // text / email / tel / number は単一行＋入力制限へ寄せる
      return "text";
  }
}

function liftFormat(type: string): FormInputFormat | null {
  switch (type) {
    case "email":
      return "email";
    case "tel":
      return "tel";
    case "number":
      return "integer";
    default:
      return null;
  }
}

/**
 * DBの文字列から layout を読む。
 *
 * 壊れていても投げない。フォームが1枚壊れただけで、回答画面が真っ白に
 * なるほうが困る。読めなければ `fields` から作り、それも無ければ空。
 */
export function parseLayout(
  rawLayout: string | null | undefined,
  fallbackFields?: unknown,
): FormLayout {
  if (rawLayout) {
    try {
      const parsed = JSON.parse(rawLayout) as unknown;
      const normalized = normalizeLayout(parsed);
      if (normalized) return normalized;
    } catch {
      // 壊れた JSON は無かったことにして、下の fields から作る
    }
  }
  if (fallbackFields !== undefined && fallbackFields !== null) {
    const fields =
      typeof fallbackFields === "string"
        ? safeJsonArray(fallbackFields)
        : fallbackFields;
    return fieldsToLayout(fields);
  }
  return emptyLayout();
}

function safeJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 形をそろえる。
 *
 * 外から来た JSON をそのまま信じない。セクションが無い・ブロックが配列で
 * ないといった欠けを、ここで埋める。
 */
export function normalizeLayout(input: unknown): FormLayout | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (formBlockTypeError(input)) return null;

  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s, i) => ({
          id: typeof s.id === "string" && s.id ? s.id : newBlockId("s"),
          name: typeof s.name === "string" && s.name ? s.name : `セクション${i + 1}`,
          blocks: normalizeBlocks(s.blocks),
        }))
    : [];

  const rawOptions = raw.options && typeof raw.options === "object"
    ? (raw.options as Record<string, unknown>)
    : {};

  return {
    version: 2,
    header: normalizeBlocks(raw.header),
    sections: sections.length
      ? sections
      : [{ id: newBlockId("s"), name: "セクション1", blocks: [] }],
    options: {
      ...FORM_OPTIONS_DEFAULT,
      ...(rawOptions as FormOptions),
      ...(rawOptions.theme === undefined
        ? {}
        : { theme: normalizeFormTheme(rawOptions.theme) }),
    },
  };
}

/** 保存前にテーマの値を許可した形へ絞る。 */
export function normalizeFormTheme(input: unknown): FormTheme {
  const raw = input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {};
  const hex = (value: unknown, fallback: string) =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  const backgroundImageUrl = typeof raw.backgroundImageUrl === "string"
    && /^https:\/\//i.test(raw.backgroundImageUrl)
    ? raw.backgroundImageUrl.slice(0, 2048)
    : null;

  return {
    main: hex(raw.main, FORM_THEME_DEFAULT.main),
    sub: hex(raw.sub, FORM_THEME_DEFAULT.sub),
    accent: hex(raw.accent, FORM_THEME_DEFAULT.accent),
    error: hex(raw.error, FORM_THEME_DEFAULT.error),
    text: hex(raw.text, FORM_THEME_DEFAULT.text),
    fontFamily: raw.fontFamily === "serif" ? "serif" : "sans",
    cornerRadius: raw.cornerRadius === "none" || raw.cornerRadius === "round"
      ? raw.cornerRadius
      : "medium",
    backgroundImageUrl,
  };
}

/** 文字と背景の組み合わせに求めるコントラスト比（WCAG AA と同じ 4.5:1）。 */
export const FORM_THEME_MIN_CONTRAST = 4.5;

/**
 * テーマの文字色と背景色の組み合わせが読めるか。
 *
 * P（回答フォームの読みにくい色）：お客さま画面は文字（text）を背景（sub）
 * の上に置く（`apps/liff/src/pages/Form.tsx`・`form-preview.tsx`）。この2色の
 * 差が 4.5:1 未満なら注意を返す。保存・公開は妨げない。問題なければ null。
 */
export function formThemeContrastError(theme: FormTheme): string | null {
  const ratio = contrastRatio(theme.text, theme.sub);
  if (ratio >= FORM_THEME_MIN_CONTRAST) return null;
  const shown = Math.floor(ratio * 10) / 10;
  return `文字と背景の色が近く、読みづらい可能性があります（いま ${shown}:1、4.5:1以上を推奨します）。文字か背景の色を変えると読みやすくなります`;
}

/** 主ボタンの背景に対して、4.5:1以上を優先して読みやすい文字色を返す。 */
export function formThemeButtonText(theme: FormTheme): string {
  const white = contrastRatio(theme.main, "#ffffff");
  const body = contrastRatio(theme.main, theme.text);
  if (white >= 4.5 && white >= body) return "#ffffff";
  if (body >= 4.5) return theme.text;
  return contrastRatio(theme.main, "#000000") >= white ? "#000000" : "#ffffff";
}

function contrastRatio(left: string, right: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
    const [r, g, b] = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function normalizeBlocks(input: unknown): FormBlock[] {
  if (!Array.isArray(input)) return [];
  const out: FormBlock[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    const kind = String(block.kind ?? "");
    if (!block.id || typeof block.id !== "string") block.id = newBlockId();

    if (kind === "input") {
      const type = String(block.type ?? "text") as FormInputType;
      const name = typeof block.name === "string" && block.name ? block.name : newBlockId("f");
      out.push({
        ...(block as unknown as FormInputBlock),
        kind: "input",
        type,
        name,
        label: typeof block.label === "string" ? block.label : "",
        choices: Array.isArray(block.choices)
          ? (block.choices as FormChoice[]).map((c, i) => ({
              ...c,
              id: c?.id ?? newBlockId("c"),
              label: typeof c?.label === "string" ? c.label : `選択肢${i + 1}`,
            }))
          : undefined,
      });
      continue;
    }

    if (kind === "image" || kind === "heading" || kind === "text" || kind === "button") {
      out.push(block as unknown as FormDecorationBlock);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

/** 都道府県。並びは総務省の全国地方公共団体コード順（北から南）。 */
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

const FORMAT_RULES: Record<
  Exclude<FormInputFormat, "none">,
  { test: (v: string) => boolean; message: string }
> = {
  // 全角カタカナと長音・空白だけ
  kana: {
    test: (v) => /^[ァ-ヶー　\s]+$/.test(v),
    message: "全角カタカナで入力してください",
  },
  email: {
    test: (v) => v.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(v),
    message: "メールアドレスの形になっていません",
  },
  // ハイフンあり・なしの両方を通す
  tel: {
    test: (v) => /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/.test(v.replace(/[‐-―ー]/g, "-")),
    message: "電話番号の形になっていません",
  },
  integer: {
    test: (v) => /^-?\d+$/.test(v),
    message: "数字だけで入力してください",
  },
  time: {
    test: (v) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v),
    message: "時刻は 9:00 のように入力してください",
  },
  zip: {
    test: (v) => /^\d{3}-?\d{4}$/.test(v),
    message: "郵便番号は 123-4567 のように入力してください",
  },
};

/**
 * 郵便番号の数字だけ（ハイフンなし・7桁）。先頭0を保つ。
 *
 * 許すのは「7桁」「3桁-4桁」と前後の空白・全角数字だけ。
 * `abc1000001` のような無関係文字の除去で有効化しない。
 */
export function normalizePostalCodeDigits(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
  const half = trimmed.replace(/[０-９]/g, (ch) => String("０１２３４５６７８９".indexOf(ch)));
  if (!/^[0-9]{3}-?[0-9]{4}$/.test(half)) return null;
  return half.replace("-", "");
}

/** 7桁を 123-4567 の表示形にする。7桁でなければそのまま返す。 */
export function formatPostalCode(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return /^\d{7}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3)}` : value;
}

/**
 * 住所オブジェクトを人向けの1行にする。
 *
 * 汎用の `String(value)` でそのまま出すと `[object Object]` になる。
 * 転記・通知・一覧の表示はこの関数を通す。
 */
export function formatAddressValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object" || Array.isArray(value)) return String(value);
  const v = value as Partial<FormAddressValue>;
  const postal = typeof v.postalCode === "string" && v.postalCode.trim() !== ""
    ? `〒${formatPostalCode(v.postalCode.trim())} `
    : "";
  const body = [v.prefecture, v.city, v.addressLine1, v.addressLine2]
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .map((part) => String(part).trim())
    .join("");
  return `${postal}${body}`.trim();
}

/** 回答値を人向けの文字にする（rating・address対応）。 */
export function formatAnswerValue(block: FormInputBlock, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (block.type === "rating") {
    const n = normalizeRatingValue(value);
    return n === null ? "" : String(n);
  }
  if (block.type === "address") return formatAddressValue(value);
  if (block.type === "booking") {
    const booking = normalizeBookingValue(value);
    return booking === null ? "" : formatBookingStartsAt(booking.startsAt);
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

/** 住所オブジェクトが空（未回答）か。全部空なら未回答。 */
export function isAddressValueEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<FormAddressValue>;
  const parts = [v.postalCode, v.prefecture, v.city, v.addressLine1, v.addressLine2];
  // 指定済みの非文字列（数・配列・物）は空にしない。後の型検査へ回す。
  return parts.every((part) => part === undefined || part === null || part === "" ||
    (typeof part === "string" && part.trim() === ""));
}

/**
 * ASCII空白（0x20）だけを落とす。SQLiteのTRIMと範囲を合わせる。
 *
 * JSのtrimは全角空白・タブ・改行も落とすが、平均集計のSQLite TRIMは
 * ASCII空白だけを落とす。受入と平均を一致させるため、ratingの前後空白は
 * ASCII空白だけを許す（「　3　」・タブ付きは受け入れない）。
 */
export function trimAsciiSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 32) start++;
  while (end > start && value.charCodeAt(end - 1) === 32) end--;
  return value.slice(start, end);
}

/** ASCII空白だけからなる文字列か（ratingの未入力判定用）。 */
export function isAsciiBlank(value: string): boolean {
  return /^ *$/.test(value);
}

/**
 * 「予約を入れる」の回答の形か。menuId・staffId・startsAt（ISO日時）の
 * 3つが文字列で揃っていれば通す。枠が今も空いているかの再確認は
 * 予約の受け口（確保の直前）が担い、ここでは形だけを見る。
 */
export function normalizeBookingValue(value: unknown): FormBookingValue | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'seats') {
    if (typeof v.storeId !== 'string' || !v.storeId || !Number.isSafeInteger(v.guestCount) || Number(v.guestCount)<1 || Number(v.guestCount)>100 || typeof v.startsAt !== 'string' || !Number.isFinite(Date.parse(v.startsAt)) || (v.courseId!=null && typeof v.courseId!=='string')) return null;
    return {kind:'seats',storeId:v.storeId,courseId:v.courseId as string|null|undefined,guestCount:Number(v.guestCount),startsAt:v.startsAt,menuId:'',staffId:''};
  }
  if (v.kind !== undefined && v.kind !== 'people') return null;
  if (typeof v.menuId !== "string" || v.menuId.trim() === "") return null;
  if (typeof v.staffId !== "string" || v.staffId.trim() === "") return null;
  if (typeof v.startsAt !== "string" || Number.isNaN(Date.parse(v.startsAt))) return null;
  return { menuId: v.menuId, staffId: v.staffId, startsAt: v.startsAt };
}

/** ISO日時を「M/D H:mm」（日本時間）にする。壊れた日時はそのまま返す。 */
export function formatBookingStartsAt(startsAt: string): string {
  const time = Date.parse(startsAt);
  if (Number.isNaN(time)) return startsAt;
  const jst = japanCalendar(new Date(time));
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const hour = String(jst.getUTCHours()).padStart(2, "0");
  const minute = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

/**
 * 5段階評価の値か。1〜5の整数と、ちょうどの "1"〜"5" だけ。
 *
 * "3.0" や "3e0" は数としては3だが、保存・平均の数え方（文字列1〜5・
 * SQLite整数）と合わせるため認めない。真偽値は数に混ぜない。
 * 前後の空白はASCII空白だけを許す。全角空白・タブ・改行付きは
 * SQLiteのTRIMと範囲が合わず平均から外れるため受け入れない。
 */
export function normalizeRatingValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = trimAsciiSpaces(value);
    return /^(1|2|3|4|5)$/.test(trimmed) ? Number(trimmed) : null;
  }
  return null;
}

/**
 * 回答1件を検証する。返すのは利用者に見せる文言。問題なければ null。
 *
 * 管理画面のプレビュー・回答画面・保存側の3か所から呼ぶ。
 */
export function validateAnswer(
  block: FormInputBlock,
  value: unknown,
): string | null {
  if (block.type === "rating") {
    const empty = value === undefined || value === null
      || (typeof value === "string" && isAsciiBlank(value));
    if (block.required && empty) return `${block.label} は必須項目です`;
    if (empty) return null;
    if (normalizeRatingValue(value) === null) {
      return `${block.label} は1〜5で選んでください`;
    }
    return null;
  }

  if (block.type === "address") {
    const empty = isAddressValueEmpty(value);
    if (block.required && empty) return `${block.label} は必須項目です`;
    if (empty) return null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return `${block.label} の住所を入力してください`;
    }
    // 指定済みの各欄は型と長さを検査する。数・配列・物を黙って空にしない。
    // 未指定（null・なし・空文字）は任意欄として保持する。
    const v = value as Record<string, unknown>;
    const names: Record<keyof Omit<FormAddressValue, "postalCode" | "prefecture">, string> = {
      city: "市区町村",
      addressLine1: "番地",
      addressLine2: "建物名",
    };
    const checkText = (key: string, label: string, max: number): string | null => {
      const raw = v[key];
      if (raw === undefined || raw === null || raw === "") return null;
      if (typeof raw !== "string") return `${block.label} の${label}は文字で入力してください`;
      if (raw.trim().length > max) return `${block.label} の${label}が長すぎます`;
      return null;
    };
    const postalRaw = v.postalCode;
    if (postalRaw !== undefined && postalRaw !== null && postalRaw !== "") {
      if (typeof postalRaw !== "string") {
        return `${block.label} の郵便番号は 123-4567 のように入力してください`;
      }
      const postal = postalRaw.trim();
      if (postal.length > 8) return `${block.label} の郵便番号は 123-4567 のように入力してください`;
      if (normalizePostalCodeDigits(postal) === null) {
        return `${block.label} の郵便番号は 123-4567 のように入力してください`;
      }
    }
    const prefectureRaw = v.prefecture;
    if (prefectureRaw !== undefined && prefectureRaw !== null && prefectureRaw !== "") {
      if (typeof prefectureRaw !== "string") {
        return `${block.label} は都道府県から選んでください`;
      }
      if (!(PREFECTURES as readonly string[]).includes(prefectureRaw.trim())) {
        return `${block.label} は都道府県から選んでください`;
      }
    }
    for (const [key, label] of Object.entries(names)) {
      const problem = checkText(key, label, 255);
      if (problem !== null) return problem;
    }
    return null;
  }

  if (block.type === "booking") {
    const empty = isFormAnswerEmpty(value);
    if (block.required && empty) return `${block.label} は必須項目です`;
    if (empty) return null;
    if (normalizeBookingValue(value) === null) {
      return `${block.label} は日時を選び直してください`;
    }
    return null;
  }

  const isEmpty = isFormAnswerEmpty(value);
  if (block.required && isEmpty) {
    return `${block.label} は必須項目です`;
  }
  if (isEmpty) return null;

  if (block.fixedField) {
    if (block.fixedField === "allergy") {
      const checked = validateAllergyValues(value);
      if (!checked.ok) return checked.error;
    }
    if (block.fixedField === "birthday" && ageFromBirthday(String(value)) === null) return `${block.label} は過去の存在する日付で入力してください`;
    if (block.fixedField === "age" && (!/^\d{1,3}$/.test(String(value)) || Number(value) > 150)) return `${block.label} は0〜150の整数で入力してください`;
    const spec = FIXED_FRIEND_FIELDS.find(f => f.key === block.fixedField);
    if (spec && spec.format !== "none") {
      const problem = validateAnswer({ ...block, fixedField: undefined, limit: { ...block.limit, format: spec.format } }, value);
      if (problem) return problem;
    }
  }

  // 選択肢系
  if (hasChoices(block)) {
    const selected = Array.isArray(value) ? value.map(String) : [String(value)];
    const labels = new Set((block.choices ?? []).map((c) => c.label));
    const allowOther = (block.choices ?? []).some((c) => c.isOther);
    if (!allowOther) {
      for (const one of selected) {
        if (!labels.has(one)) return `${block.label} に無い選択肢が選ばれています`;
      }
    }
    if (block.type === "checkbox" && block.selectionLimit) {
      const { min, max } = block.selectionLimit;
      if (typeof min === "number" && selected.length < min) {
        return `${block.label} は${min}つ以上選んでください`;
      }
      if (typeof max === "number" && max > 0 && selected.length > max) {
        return `${block.label} は${max}つまで選べます`;
      }
    }
    return null;
  }

  if (block.type === "prefecture") {
    if (!PREFECTURES.includes(String(value) as (typeof PREFECTURES)[number])) {
      return `${block.label} は都道府県から選んでください`;
    }
    return null;
  }

  if (block.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      return `${block.label} は日付を選んでください`;
    }
    if (!isCalendarDateString(String(value))) {
      return `${block.label} は存在しない日付です`;
    }
    return null;
  }

  if (block.type === "file") {
    if (Array.isArray(value)) {
      const max = formFileKind(block) === "identity" && block.fileBothSides ? 2 : Math.min(10, Math.max(1, block.fileMaxCount ?? 1));
      if (value.length > max || value.some(v => !v || typeof v !== "object" || typeof v.fileId !== "string" || !/^[0-9a-f-]{36}$/i.test(v.fileId))) return `${block.label} の添付を確認してください`;
      if (value.length && formFileKind(block) === "identity" && block.fileBothSides && value.length !== 2) return `${block.label} の表と裏を送ってください`;
      return null;
    }
    // 回答に入るのは、預けた画像のURL。中身そのものは入らない。
    // 別の場所を指すURLを書き込まれても困るので、こちらが返す形だけを通す。
    if (!/^https?:\/\/[^\s]+\/images\/form-uploads\//.test(String(value))) {
      return `${block.label} の画像を送りなおしてください`;
    }
    return null;
  }

  const text = String(value);

  if (block.limit) {
    const { format, min, max } = block.limit;
    if (typeof min === "number" && min > 0 && text.length < min) {
      return `${block.label} は${min}文字以上で入力してください`;
    }
    if (typeof max === "number" && max > 0 && text.length > max) {
      return `${block.label} は${max}文字までです`;
    }
    if (format && format !== "none") {
      const rule = FORMAT_RULES[format];
      if (rule && !rule.test(text)) return `${block.label} は${rule.message}`;
    }
  }

  return null;
}

/** 回答全体を検証する。最初に見つかった1件を返す。 */
export function validateAnswers(
  layout: FormLayout,
  answers: Record<string, unknown>,
): string | null {
  for (const block of collectReachableInputs(layout, answers)) {
    // 出していない欄は、答えが無くても責めない
    if (block.hidden) continue;
    const error = validateAnswer(block, answers[block.name]);
    if (error) return error;
  }
  return null;
}

/**
 * 選んだ選択肢から、次に進むセクションの位置を決める。
 *
 * 分岐は「先に書いてある選択肢が勝つ」。複数選択で行き先が2つ出たときに
 * どちらへ行くかを、画面と保存側で同じにするため。
 *
 * 分岐の起点にできるのは**セクション内の選択肢だけ**。共通ヘッダは
 * すべてのページに出るので、ここでは見ない（編集画面では分岐欄自体を
 * 出さず、公開前の検査 `validateFormForPublish` が残った設定を止める）。
 */
export function nextSectionIndex(
  layout: FormLayout,
  currentIndex: number,
  answers: Record<string, unknown>,
): number {
  const section = layout.sections[currentIndex];
  if (!section) return currentIndex + 1;

  for (const block of section.blocks) {
    if (!isInputBlock(block) || !hasChoices(block)) continue;
    const raw = answers[block.name];
    const selected = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
    for (const choice of block.choices ?? []) {
      if (!choice.jumpToSectionId) continue;
      if (!formChoiceIsSelected(block, choice, selected)) continue;
      const to = layout.sections.findIndex((s) => s.id === choice.jumpToSectionId);
      if (to >= 0) return to;
    }
  }
  return currentIndex + 1;
}

/** 回答の分岐で実際に通る欄。共通ヘッダはどの経路でも含める。 */
export function collectReachableInputs(layout: FormLayout, answers: Record<string, unknown>): FormInputBlock[] {
  const sections: FormLayout['sections'] = [];
  const visited = new Set<number>();
  for (let index = 0; index < layout.sections.length && !visited.has(index);) {
    visited.add(index);
    sections.push(layout.sections[index]!);
    index = nextSectionIndex(layout, index, answers);
  }
  return collectInputs({ ...layout, sections });
}

// ---------------------------------------------------------------------------
// フォーム定義の検証（保存時・公開時）
// ---------------------------------------------------------------------------

/** 選択肢の定員の上限。これを超える数は入力ミスとして止める。 */
export const FORM_CHOICE_CAPACITY_MAX = 1_000_000;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
}

/**
 * 保存できるフォーム定義か。返すのは画面に出す文言で、問題なければ null。
 *
 * 管理画面の保存ボタンと、保存APIが同じ判定を使う。「画面では保存できた
 * のにAPIで弾かれる」（逆も）を起こさないため、ここに置く。
 * ここでは「定義として成り立つか」だけを見る。分岐の循環や設定途中の
 * 動作のように、下書きは許すが公開では止めるものは
 * `validateFormForPublish` が見る。
 */
/** 保存前に未知のブロックを拒否する。正規化で消してから検証すると誤って保存できてしまう。 */
export function formBlockTypeError(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const groups = [raw.header, ...(Array.isArray(raw.sections) ? raw.sections.map(s => s && typeof s === "object" ? (s as Record<string, unknown>).blocks : []) : [])];
  for (const blocks of groups) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== "object") return "ブロックの種類を確認してください";
      const b = block as Record<string, unknown>;
      if (!FORM_BLOCK_KINDS.includes(String(b.kind))) return "このブロックの種類は保存できません";
      if (b.kind === "input" && !FORM_INPUT_TYPES.includes(b.type as FormInputType)) return "この入力欄の種類は保存できません";
      if (b.fixedField !== undefined) {
        const spec = FIXED_FRIEND_FIELDS.find(f => f.key === b.fixedField);
        if (b.kind !== "input" || !spec || (b.type !== spec.type && !(b.fixedField === 'allergy' && b.type === 'text'))) return "決まった答えの種類を確認してください";
      }
    }
  }
  return null;
}

export function validateFormDefinition(layout: FormLayout): string | null {
  const design = layout.options.customerDesign;
  if (design !== undefined && (!design || !['account','fixed'].includes(design.mode) || !CUSTOMER_DESIGN_IDS.includes(design.preset))) return 'デザインの型を選び直してください';
  const typeError = formBlockTypeError(layout);
  if (typeError) return typeError;
  const seenNames = new Set<string>();
  const groups: { where: string; blocks: FormBlock[] }[] = [
    { where: "共通ヘッダ", blocks: layout.header },
    ...layout.sections.map((section, index) => ({
      where: section.name || `セクション${index + 1}`,
      blocks: section.blocks,
    })),
  ];

  for (const group of groups) {
    let imageCount = 0;
    for (const block of group.blocks) {
      /*
       * R197: 画像のURLと、押したときに開くURLもボタンのリンク先と
       * 同じ決めごとで見る。空は「未指定」（下書きでは許す）とし、
       * 入っているのにURLの形でないものだけ止める。
       */
      if (block.kind === "image") {
        imageCount += 1;
        const at = `「${group.where}」の${imageCount}枚目の画像`;
        const mediaUrl = (block.mediaUrl ?? "").trim();
        if (mediaUrl !== "" && !isHttpUrl(mediaUrl)) {
          return `${at}のURLがURLの形ではありません`;
        }
        const linkUrl = (block.linkUrl ?? "").trim();
        if (linkUrl !== "" && !isHttpUrl(linkUrl)) {
          return `${at}を押したときに開くURLがURLの形ではありません`;
        }
        continue;
      }
      if (block.kind === "input") {
        const title = block.label.trim() || block.name;
        const at = `「${group.where}」の「${title}」`;
        if (!block.label.trim()) return "タイトルが空のブロックがあります";
        if (seenNames.has(block.name)) {
          return `回答データの見出し「${block.name}」が重複しています`;
        }
        seenNames.add(block.name);
        if (block.type === "booking" && block.booking != null) {
          if (typeof block.booking !== "object" || Array.isArray(block.booking)) return `${at}の予約設定を確認してください`;
          for (const [key, label] of [["allowMenuSelection", "メニューを選んでもらう"], ["requireApproval", "未承認で入れる"]] as const) {
            if (block.booking[key] !== undefined && typeof block.booking[key] !== "boolean") return `${at}の「${label}」はオン・オフで指定してください`;
          }
        }
        if (block.type === "file") {
          if (block.fileKinds !== undefined && (!Array.isArray(block.fileKinds) || !block.fileKinds.length || block.fileKinds.some(kind => !["image", "pdf", "identity"].includes(kind)))) return `${at}で受け取る種類を1つ以上選んでください`;
          if (block.fileKind && !["image", "pdf", "identity"].includes(block.fileKind)) return `${at}のファイルの種類を選んでください`;
          if (block.fileMaxCount !== undefined && (!Number.isInteger(block.fileMaxCount) || block.fileMaxCount < 1 || block.fileMaxCount > 10)) return `${at}の枚数の上限は1〜10枚です`;
          if (block.fileBothSides !== undefined && typeof block.fileBothSides !== "boolean") return `${at}の表と裏の設定を確認してください`;
        }

        if (hasChoices(block)) {
          const choices = block.choices ?? [];
          if (choices.length === 0) return `${at}に選択肢がありません`;
          if (choices.some((choice) => !choice.label.trim())) {
            return `${at}に空の選択肢があります`;
          }
          if (
            (block.type === "radio" || block.type === "select") &&
            choices.filter((choice) => choice.defaultSelected).length > 1
          ) {
            return `${at}の「はじめから選んでおく」は1つまでにしてください`;
          }
          for (const choice of choices) {
            if (!choice.capacity?.enabled) continue;
            const limit = choice.capacity.limit;
            if (
              typeof limit !== "number" ||
              !Number.isInteger(limit) ||
              limit < 1 ||
              limit > FORM_CHOICE_CAPACITY_MAX
            ) {
              return `${at}の選択肢「${choice.label}」の定員は1以上${FORM_CHOICE_CAPACITY_MAX}以下の整数にしてください`;
            }
          }
          if (block.type === "checkbox" && block.selectionLimit) {
            const { min, max } = block.selectionLimit;
            if (min !== undefined && (!Number.isInteger(min) || min < 0)) {
              return `${at}の「つ以上」は0以上の整数にしてください`;
            }
            if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
              return `${at}の「つまで」は0以上の整数にしてください`;
            }
            // 0 は「制限なし」の意味（回答側の判定も min>0 / max>0 で見ている）
            const effMin = typeof min === "number" && min > 0 ? min : undefined;
            const effMax = typeof max === "number" && max > 0 ? max : undefined;
            if (effMin !== undefined && effMax !== undefined && effMin > effMax) {
              return `${at}の選択数の下限が上限を超えています`;
            }
            if (effMin !== undefined && effMin > choices.length) {
              return `${at}は選択肢が${choices.length}個しかないのに${effMin}つ以上選ぶ設定になっています`;
            }
          }
        }

        if (
          (block.type === "text" || block.type === "textarea") &&
          block.limit
        ) {
          const { min, max } = block.limit;
          if (min !== undefined && (!Number.isInteger(min) || min < 0)) {
            return `${at}の最小文字数は0以上の整数にしてください`;
          }
          if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
            return `${at}の最大文字数は0以上の整数にしてください`;
          }
          // 0 は「制限なし」の意味。両方に正の数があるときだけ大小を比べる
          const effMin = typeof min === "number" && min > 0 ? min : undefined;
          const effMax = typeof max === "number" && max > 0 ? max : undefined;
          if (effMin !== undefined && effMax !== undefined && effMin > effMax) {
            return `${at}の最小文字数が最大文字数を超えています`;
          }
        }
      }

      if (
        block.kind === "button" &&
        block.url.trim() !== "" &&
        !isHttpUrl(block.url)
      ) {
        return `ボタン「${block.label}」のリンク先がURLの形ではありません`;
      }
    }
  }

  const completionMode = layout.options.completionMode;
  if (completionMode !== undefined && !["thanks", "chat", "url"].includes(completionMode)) return "答え終わったあとの動きを選び直してください";
  const thanksUrl = layout.options.thanksUrl?.trim() ?? "";
  if (completionMode === "url" && !thanksUrl) return "答えたあとに開くURLを入力してください";
  if ((completionMode === "chat" || completionMode === "thanks") && thanksUrl) return "URLを開く場合は、答え終わったあとの動きをURLにしてください";
  if (thanksUrl !== "" && !isHttpUrl(thanksUrl)) {
    return "答えたあとに開くページがURLの形ではありません";
  }
  if (layout.options.deadline?.enabled) {
    const endsAt = layout.options.deadline.endsAt?.trim() ?? "";
    if (endsAt === "" || Number.isNaN(Date.parse(endsAt))) {
      return "受付の期限が日時の形ではありません";
    }
  }
  return null;
}

/** 動作1件が、公開して実際に実行できる状態か。問題があれば文言を返す。 */
function formActionProblem(
  action: FormAction,
  where: string,
): string | null {
  switch (action.kind) {
    case "send_text":
      return action.text.trim() ? null : `${where}の「テキストを送る」に本文がありません`;
    case "send_template":
      return action.templateId ? null : `${where}の「テンプレートを送る」にテンプレートが選ばれていません`;
    case "tag":
      return action.tagIds.length
        ? null
        : `${where}の「タグを付ける・外す」にタグが選ばれていません`;
    case "friend_field":
      return action.fieldId ? null : `${where}の「友だち情報に書く」に情報欄が選ばれていません`;
    case "scenario":
      return action.scenarioId ? null : `${where}の「シナリオを開始・停止」にシナリオが選ばれていません`;
    case "reminder":
      return action.reminderId ? null : `${where}の「リマインダを開始」にリマインダが選ばれていません`;
    default:
      return null;
  }
}

/**
 * 設定途中の動作が残っていないか。
 *
 * 選ぶ先が空の動作は、保存は許すが公開では止める。公開後に
 * 「選ばれたのに何も起きない」を作らないため。
 */
function validateFormActionsReady(layout: FormLayout): string | null {
  const groups: { where: string; blocks: FormBlock[] }[] = [
    { where: "共通ヘッダ", blocks: layout.header },
    ...layout.sections.map((section, index) => ({
      where: section.name || `セクション${index + 1}`,
      blocks: section.blocks,
    })),
  ];
  for (const group of groups) {
    for (const block of group.blocks) {
      if (block.kind !== "input") continue;
      const at = `「${group.where}」の「${block.label.trim() || block.name}」`;
      if (block.type === "date" && block.reminder && !block.reminder.reminderId) {
        return `${at}の日付リマインダが選ばれていません`;
      }
      for (const choice of block.choices ?? []) {
        for (const [index, action] of (choice.actions ?? []).entries()) {
          const problem = formActionProblem(
            action,
            `${at}の選択肢「${choice.label}」の動作${index + 1}`,
          );
          if (problem) return problem;
        }
      }
    }
  }
  for (const [index, action] of (layout.options.afterActions ?? []).entries()) {
    const problem = formActionProblem(action, `回答後の動作${index + 1}番目`);
    if (problem) return problem;
  }
  return null;
}

/**
 * ページ分岐が壊れていないか（循環・消えた行き先・共通ヘッダの分岐）。
 *
 * 分岐先は「今のページより後ろ」だけを許す。こう決めると自己参照・
 * ループが構造上作れず、「前のページへ戻る分岐」の半端な実装を
 * 残さなくて済む。下書きの保存までは止めず、公開の直前で止める。
 */
function validateFormBranchGraph(layout: FormLayout): string | null {
  // 共通ヘッダはすべてのページに出るため、分岐の起点にはできない。
  // 昔の定義に残っていても無断で消さず、公開のときに文言で止める。
  for (const block of layout.header) {
    if (!isInputBlock(block)) continue;
    const branched = (block.choices ?? []).find((choice) => choice.jumpToSectionId);
    if (branched) {
      return `共通ヘッダの「${block.label.trim() || block.name}」の選択肢「${branched.label}」にページ分岐が設定されています。共通ヘッダはすべてのページに出るため分岐には使えません。分岐したい質問は各ページに置いてください`;
    }
  }

  const indexOf = new Map(layout.sections.map((section, i) => [section.id, i]));
  const edges: Set<number>[] = layout.sections.map(() => new Set());
  for (const [i, section] of layout.sections.entries()) {
    // 行き先のない選択肢は次のページへ。末尾は「送信」を表す番号
    edges[i].add(i + 1);
    for (const block of section.blocks) {
      if (!isInputBlock(block)) continue;
      const title = block.label.trim() || block.name;
      for (const choice of block.choices ?? []) {
        if (!choice.jumpToSectionId) continue;
        const to = indexOf.get(choice.jumpToSectionId);
        if (to === undefined) {
          return `「${section.name}」の「${title}」の選択肢「${choice.label}」は、もう無いページを指しています`;
        }
        if (to <= i) {
          return `「${section.name}」の「${title}」の選択肢「${choice.label}」の分岐が循環します。分岐先はこのページより後ろのページにしてください`;
        }
        edges[i].add(to);
      }
    }
  }

  const end = layout.sections.length;
  const reachable = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const current = queue.pop();
    if (current === undefined) break;
    for (const next of edges[current] ?? []) {
      if (next === end || reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  const orphan = layout.sections.findIndex((_, i) => !reachable.has(i));
  if (orphan >= 0) {
    return `「${layout.sections[orphan].name}」へたどり着く経路がありません`;
  }

  // 前向き分岐だけなら起きないが、将来「戻る分岐」が入っても
  // 送信へ辿れない経路はここで止める。
  const canFinish = new Set<number>([end]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [i, targets] of edges.entries()) {
      if (canFinish.has(i)) continue;
      if ([...targets].some((target) => canFinish.has(target))) {
        canFinish.add(i);
        changed = true;
      }
    }
  }
  const stuck = layout.sections.findIndex(
    (_, i) => reachable.has(i) && !canFinish.has(i),
  );
  if (stuck >= 0) {
    return `「${layout.sections[stuck].name}」から送信へ進めない経路があります`;
  }
  return null;
}

/**
 * 初期値が、その欄の回答の決まりに合っているか。
 *
 * R196: 空の初期値は「未設定」で許す。入っているのに型・選択肢・
 * 入力制限に合わないものは、公開の直前で止める。そのまま公開すると
 * 管理者が入れた初期値のせいで回答者が送信できなくなるため。
 * 判定は回答検証 `validateAnswer` と同じものを使う（必須だけ外す。
 * 初期値が空でも回答者が入れればよい）。
 */
function validateFormDefaultValues(layout: FormLayout): string | null {
  const groups: { where: string; blocks: FormBlock[] }[] = [
    { where: "共通ヘッダ", blocks: layout.header },
    ...layout.sections.map((section, index) => ({
      where: section.name || `セクション${index + 1}`,
      blocks: section.blocks,
    })),
  ];

  for (const group of groups) {
    for (const block of group.blocks) {
      if (block.kind !== "input") continue;
      if (block.defaultValue === undefined || block.defaultValue === "") continue;
      const title = block.label.trim() || block.name;
      const at = `「${group.where}」の「${title}」`;
      const error = validateAnswer({ ...block, required: false }, block.defaultValue);
      if (error) return `${at}の初期値：${error}`;
    }
  }
  return null;
}

/**
 * 公開できる状態か。返すのは画面に出す文言で、問題なければ null。
 *
 * 保存時の定義検証に加えて、下書きでは許すが公開では止めるものを見る:
 * 分岐の循環・消えた行き先・共通ヘッダの分岐・選ぶ先が空の動作・
 * 回答の決まりに合わない初期値。
 * 管理画面の「公開して保存」と公開APIの両方から呼ぶ。
 */
export function validateFormForPublish(layout: FormLayout): string | null {
  return (
    validateFormDefinition(layout) ??
    validateFormActionsReady(layout) ??
    validateFormBranchGraph(layout) ??
    validateFormDefaultValues(layout) ??
    validateFormBookingReady(layout)
  );
}

/**
 * 「予約を入れる」ブロックはメニューが決まっていないと公開できない。
 * 下書きの保存までは止めない。担当の指定が無ければ「だれでも」、
 * 期間が無ければ14日として扱うので、止めるのはメニューだけ。
 */
export function validateFormBookingReady(layout: FormLayout): string | null {
  const groups = [layout.header, ...layout.sections.map((section) => section.blocks)];
  for (const blocks of groups) {
    for (const block of blocks) {
      if (block.kind !== "input" || block.type !== "booking") continue;
      const at = `「${block.label.trim() || block.name}」`;
      if (block.booking?.kind === 'seats') {
        if (!block.booking.storeId) return `${at}のお店が選ばれていません`;
        continue;
      }
      if (!block.booking?.menuId) {
        return `${at}の予約メニューが選ばれていません`;
      }
    }
  }
  return null;
}
