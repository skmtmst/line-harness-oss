import type { TapExtras } from './tap-extras.js';
import type { ResearchAnswerAction } from './types/research.js';

/**
 * 選択肢1つ。
 *
 * 「選んだら何が起きるか」は選択肢ごとに違う。ブロック側の `choiceMode`
 * がどの列を使うかを決める。
 */
export interface FormChoice {
  /** リサーチで選んだ答えの追加処理。回答を送信した後に実行する。 */
  tapExtras?: TapExtras;
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
  | ({ kind: "research_action" } & ResearchAnswerAction)
  | { kind: "send_text"; text: string }
  | { kind: "send_template"; templateId: string }
  | { kind: "tag"; op: "add" | "remove"; tagIds: string[] }
  | { kind: "friend_field"; fieldId: string; value: string }
  | { kind: "scenario"; op: "start" | "stop"; scenarioId: string }
  | { kind: "reminder"; reminderId: string };
