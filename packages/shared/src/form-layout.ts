/**
 * 回答フォームの中身（レイアウト）。
 *
 * これまでフォームは `forms.fields` の平らな配列だけで持っていた。項目を
 * 縦に並べるところまでは足りるが、次の3つが表現できない。
 *
 *   1. ページ分け（セクション）と、選択肢による分岐
 *   2. 選択肢ごとに「押されたら何が起きるか」（タグ・友だち情報・アクション）
 *   3. 入力欄ではない飾り（画像・見出し・説明文・ボタン）
 *
 * そこで `forms.layout` に、この形の JSON を1本入れる。`fields` は
 * **捨てない**。保存のたびに layout の入力ブロックから作り直して書き戻す。
 * 送信時の必須チェック・回答一覧の見出し・友だち詳細の表示が、これまで
 * どおり `fields` を読んで動き続けるようにするため。
 *
 * 型と一緒に、layout を読む/作る/検証する関数もここに置く。管理画面
 * （apps/web）・回答画面（apps/liff）・保存側（apps/worker）の3か所が
 * 同じ判定を使わないと、「画面では通ったのに保存で弾かれる」が起きる。
 */

// ---------------------------------------------------------------------------
// ブロック
// ---------------------------------------------------------------------------

/** 入力欄の種類。値は回答データの形とひも付くので、後から変えない。 */
export type FormInputType =
  | "text" // 単一行
  | "textarea" // 複数行
  | "radio" // ラジオボタン
  | "checkbox" // チェックボックス
  | "select" // プルダウン
  | "file" // ファイル添付
  | "date" // 日付
  | "prefecture"; // 都道府県

/** 単一行の入力制限。空欄や「指定なし」は検証しない。 */
export type FormInputFormat =
  | "none"
  | "kana"
  | "email"
  | "tel"
  | "integer"
  | "time"
  | "zip";

/**
 * 回答の登録先。
 *
 * 友だち情報欄は複数選べる（同じ回答を「本名」と「お名前（漢字）」の
 * 両方に入れたい、という運用があるため）。`realName` などは友だちレコード
 * 本体の列に入れる指定。
 */
export interface FormDestinations {
  /** 友だち情報欄の項目ID。複数可 */
  friendFieldIds?: string[];
  /** friends.real_name に入れる */
  realName?: boolean;
  /** friends.display_name（システム表示名）に入れる */
  displayName?: boolean;
  /** friends.note（個別メモ）に追記する */
  note?: boolean;
}

/** 入力制限。 */
export interface FormInputLimit {
  format?: FormInputFormat;
  /** 最小文字数。未設定は下限なし */
  min?: number;
  /** 最大文字数。未設定は上限なし */
  max?: number;
  /** 入力欄の下に出る文字数カウンタを消す */
  hideCounter?: boolean;
}

/**
 * 選択肢1つ。
 *
 * 「選んだら何が起きるか」は選択肢ごとに違う。ブロック側の `choiceMode`
 * がどの列を使うかを決める。
 */
export interface FormChoice {
  id: string;
  label: string;
  /** choiceMode = 'tag' のとき付けるタグ */
  tagId?: string | null;
  /** choiceMode = 'friendField' のとき情報欄へ入れる値。空ならラベルを入れる */
  value?: string;
  /** choiceMode = 'action' のとき実行する動作 */
  actions?: FormAction[];
  /** 最初から選んだ状態で出す */
  defaultSelected?: boolean;
  /** 定員。埋まった選択肢は選べなくする */
  capacity?: { enabled: boolean; limit?: number } | null;
  /** 選んだ人だけ飛ばすセクション。未設定なら次のセクションへ進む */
  jumpToSectionId?: string | null;
  /** 「その他」（自由入力を伴う選択肢） */
  isOther?: boolean;
}

/**
 * 選択肢や回答後に実行する動作。
 *
 * こちら側に受け皿がある動作だけを型に入れている。Lステップにある
 * 「対応マーク操作」「イベント予約操作」「共通情報操作」は、繋ぐ先の
 * 仕様を決めてから足す。型に無い動作は保存時に落とす。
 */
export type FormAction =
  | { kind: "send_text"; text: string }
  | { kind: "send_template"; templateId: string }
  | { kind: "tag"; op: "add" | "remove"; tagIds: string[] }
  | { kind: "friend_field"; fieldId: string; value: string }
  | { kind: "scenario"; op: "start" | "stop"; scenarioId: string }
  | { kind: "reminder"; reminderId: string };

/** 入力欄のブロック。 */
export interface FormInputBlock {
  id: string;
  kind: "input";
  type: FormInputType;
  /**
   * 回答データの見出し。**作ったあとは変えない。**
   * ここを変えると、それまでの回答と結びつかなくなる。
   */
  name: string;
  label: string;
  required?: boolean;
  /** 画面に出さない。既定値や自動入力だけ入れたいときに使う */
  hidden?: boolean;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  destinations?: FormDestinations;
  limit?: FormInputLimit;
  /** 選択肢系（radio / checkbox / select）で、選んだときに何をするか */
  choiceMode?: "tag" | "friendField" | "action";
  /** choiceMode = 'friendField' のときの登録先。選択肢の値をここへ入れる */
  choiceFriendFieldId?: string | null;
  choices?: FormChoice[];
  /** 選択肢を横に並べる（radio / checkbox） */
  inline?: boolean;
  /** チェックボックスの選択数制限 */
  selectionLimit?: { min?: number; max?: number };
  /** 日付の出し方 */
  dateStyle?: "calendar" | "ymd";
  /** 入力された日付を起点にリマインダを動かす */
  reminder?: { reminderId: string; time: string } | null;
  /** ファイルの種類。いまは画像だけ */
  fileKind?: "image";
}

/** 飾りのブロック（入力欄ではないもの）。 */
export type FormDecorationBlock =
  | {
      id: string;
      kind: "image";
      mediaUrl: string;
      size?: "normal" | "full";
      linkUrl?: string;
    }
  | { id: string; kind: "heading"; text: string; level?: 1 | 2 | 3 }
  | { id: string; kind: "text"; text: string }
  | {
      id: string;
      kind: "button";
      label: string;
      url: string;
      style?: "default" | "outline";
    };

export type FormBlock = FormInputBlock | FormDecorationBlock;

/** セクション＝1ページ。 */
export interface FormSection {
  id: string;
  name: string;
  blocks: FormBlock[];
}

// ---------------------------------------------------------------------------
// フォーム全体の設定
// ---------------------------------------------------------------------------

export interface FormOptions {
  /** 送信後に飛ばす先。空なら thanksText を出す */
  thanksUrl?: string | null;
  thanksText?: string | null;
  /** 2回目以降、前回の回答を初期値として出す */
  restorePrevious?: boolean;
  /** ブラウザのタブに出る名前 */
  pageTitle?: string | null;
  submitLabel?: string;
  prevLabel?: string;
  nextLabel?: string;
  /** 複数セクションのときの見出しの出し方 */
  sectionHeader?: "pageNumber" | "name" | "none";
  confirmDialog?: {
    enabled: boolean;
    text?: string;
    okLabel?: string;
    cancelLabel?: string;
  };
  /** 回答期限。過ぎたら受け付けない */
  deadline?: { enabled: boolean; endsAt?: string | null; message?: string };
  /** 1人1回だけ */
  oncePerFriend?: { enabled: boolean; message?: string };
  /** 全体の受付上限 */
  totalLimit?: { enabled: boolean; max?: number; message?: string };
  /** 送信できたあとに動かす動作 */
  afterActions?: FormAction[];
  /** 回答者に見せるフォームの色・書体・角丸。任意のCSSは保存しない。 */
  theme?: FormTheme;
}

export type FormFontFamily = "sans" | "serif";
export type FormCornerRadius = "none" | "medium" | "round";

/**
 * フォームの見た目は5つの色の役割だけで持つ。
 *
 * CSS文字列を受け取らないことで、管理画面から任意のコードを公開画面へ
 * 混ぜられないようにする。
 */
export interface FormTheme {
  main: string;
  sub: string;
  accent: string;
  error: string;
  text: string;
  fontFamily: FormFontFamily;
  cornerRadius: FormCornerRadius;
  backgroundImageUrl: string | null;
}

export interface FormLayout {
  version: 2;
  /** 全セクションの先頭に出る共通部分 */
  header: FormBlock[];
  sections: FormSection[];
  options: FormOptions;
}

/** 互換のために `forms.fields` へ書き戻す平らな項目定義。 */
export interface FormFieldCompat {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  description?: string;
  friendFieldId?: string | null;
}

// ---------------------------------------------------------------------------
// 既定値
// ---------------------------------------------------------------------------

export const FORM_OPTIONS_DEFAULT: FormOptions = {
  thanksUrl: null,
  thanksText: "ご回答ありがとうございました。",
  restorePrevious: false,
  pageTitle: null,
  submitLabel: "送信",
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
  return false;
}

/** YYYY-MM-DD の形で、暦に存在する日付か（2/30 や 13/40 を通さない）。 */
export function isCalendarDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
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
    test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
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
 * 回答1件を検証する。返すのは利用者に見せる文言。問題なければ null。
 *
 * 管理画面のプレビュー・回答画面・保存側の3か所から呼ぶ。
 */
export function validateAnswer(
  block: FormInputBlock,
  value: unknown,
): string | null {
  const isEmpty = isFormAnswerEmpty(value);

  if (block.required && isEmpty) {
    return `${block.label} は必須項目です`;
  }
  if (isEmpty) return null;

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
      if (typeof max === "number" && selected.length > max) {
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
  for (const block of collectInputs(layout)) {
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
export function validateFormDefinition(layout: FormLayout): string | null {
  const seenNames = new Set<string>();
  const groups: { where: string; blocks: FormBlock[] }[] = [
    { where: "共通ヘッダ", blocks: layout.header },
    ...layout.sections.map((section, index) => ({
      where: section.name || `セクション${index + 1}`,
      blocks: section.blocks,
    })),
  ];

  for (const group of groups) {
    for (const block of group.blocks) {
      if (block.kind === "input") {
        const title = block.label.trim() || block.name;
        const at = `「${group.where}」の「${title}」`;
        if (!block.label.trim()) return "タイトルが空のブロックがあります";
        if (seenNames.has(block.name)) {
          return `回答データの見出し「${block.name}」が重複しています`;
        }
        seenNames.add(block.name);

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

  const thanksUrl = layout.options.thanksUrl?.trim() ?? "";
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
 * 公開できる状態か。返すのは画面に出す文言で、問題なければ null。
 *
 * 保存時の定義検証に加えて、下書きでは許すが公開では止めるものを見る:
 * 分岐の循環・消えた行き先・共通ヘッダの分岐・選ぶ先が空の動作。
 * 管理画面の「公開して保存」と公開APIの両方から呼ぶ。
 */
export function validateFormForPublish(layout: FormLayout): string | null {
  return (
    validateFormDefinition(layout) ??
    validateFormActionsReady(layout) ??
    validateFormBranchGraph(layout)
  );
}
