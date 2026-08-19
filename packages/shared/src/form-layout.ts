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

  return {
    version: 2,
    header: normalizeBlocks(raw.header),
    sections: sections.length
      ? sections
      : [{ id: newBlockId("s"), name: "セクション1", blocks: [] }],
    options: {
      ...FORM_OPTIONS_DEFAULT,
      ...(raw.options && typeof raw.options === "object"
        ? (raw.options as FormOptions)
        : {}),
    },
  };
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
  const isEmpty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

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
      if (!selected.includes(choice.label)) continue;
      const to = layout.sections.findIndex((s) => s.id === choice.jumpToSectionId);
      if (to >= 0) return to;
    }
  }
  return currentIndex + 1;
}
