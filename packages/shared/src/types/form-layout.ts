import type { FormChoice, FormAction } from '../form-choice-types.js';
import type { FormBookingConfig } from '../form-booking-types.js';
import type { FixedFriendFieldKey } from '../fixed-friend-fields.js';
import type { ResearchGate } from './research.js';
import type { CUSTOMER_DESIGN_IDS } from '../form-design-presets.js';

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
 * 型をここに集め、layout を読む/作る/検証する関数は form-layout に置く。管理画面
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
  | "prefecture" // 都道府県
  | "rating" // 5段階評価（F11）
  | "address" // 住所（F11・郵便番号から補完）
  | "booking"; // 予約を入れる（フォームの中で空き枠を選ぶ）

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
  /** 受信箱のメモ（chats.notes）に追記する */
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
  /** 7つの基本項目への自動保存。統括から配っても同じ意味を持つ。 */
  fixedField?: FixedFriendFieldKey;
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
  /** ファイルの種類。未設定の既存ブロックは写真。 */
  fileKind?: "image" | "pdf" | "identity";
  fileKinds?: ("image" | "pdf" | "identity")[];
  fileBothSides?: boolean;
  fileMaxCount?: number;
  /** type = 'booking' のときの「予約を入れる」の設定 */
  booking?: FormBookingConfig | null;
}

export interface FormFileAnswer {
  fileId: string;
  kind?: "image" | "pdf" | "identity";
  side?: "single" | "front" | "back";
  filename?: string;
  mimeType?: string;
  state?: "ready" | "pending" | "quarantined" | "rejected" | "restricted" | "expired";
}

/** 飾りのブロック（入力欄ではないもの）。 */
export type FormDecorationBlock =
  | {
      id: string;
      kind: "image";
      mediaUrl: string;
      alt?: string;
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
  /** 回答の完了後：お礼・トークへ戻す・URL。未指定は従来のthanksUrl判定。 */
  completionMode?: "thanks" | "chat" | "url";
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
  /** リサーチの公開版から作る回答フォームの受付条件。 */
  researchGate?: ResearchGate;
  /** 回答者に見せるフォームの色・書体・角丸。任意のCSSは保存しない。 */
  theme?: FormTheme;
  customerDesign?: {mode: 'account' | 'fixed'; preset: CustomerDesignPreset};
}

export type CustomerDesignPreset = typeof CUSTOMER_DESIGN_IDS[number];

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

/**
 * F11 住所の回答の形。
 *
 * 郵便番号は文字列で持つ。先頭の 0 を落とさないため数にしない。
 * 郵便番号を変えても手入力の住所は消さない（上書きは補完を選んだときだけ）。
 */
export interface FormAddressValue {
  postalCode: string;
  prefecture: string;
  city: string;
  addressLine1: string;
  addressLine2?: string;
}
