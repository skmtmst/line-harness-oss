/**
 * 回答フォーム一覧の絞り込み・並び替え・保存先の数え上げ。
 *
 * 一覧のページ分けを Worker 側へ寄せた（#1060 / N+1 解消）ため、
 * 管理画面と Worker が**同じ規則**で絞り込み・並び替えをする必要がある。
 * ここを正本にして、画面（apps/web）とAPI（apps/worker）の両方から使う。
 */
import { collectInputs, type FormAction, type FormInputBlock, type FormLayout } from "./form-layout";

// ---------------------------------------------------------------------------
// 保存先（友だち情報欄・タグ）の数え上げ
// ---------------------------------------------------------------------------

export type FormDestinationSummary = {
  friendFieldCount: number;
  tagCount: number;
  label: string;
};

function collectActionDestinations(
  actions: FormAction[] | undefined,
  friendFields: Set<string>,
  tags: Set<string>,
) {
  for (const action of actions ?? []) {
    if (action.kind === "friend_field" && action.fieldId) {
      friendFields.add(action.fieldId);
    }
    if (action.kind === "tag") {
      for (const tagId of action.tagIds) {
        if (tagId) tags.add(tagId);
      }
    }
  }
}

function collectInputDestinations(
  block: FormInputBlock,
  friendFields: Set<string>,
  tags: Set<string>,
) {
  for (const fieldId of block.destinations?.friendFieldIds ?? []) {
    if (fieldId) friendFields.add(fieldId);
  }
  if (block.destinations?.realName) friendFields.add("friends.real_name");
  if (block.destinations?.displayName) friendFields.add("friends.display_name");
  if (block.destinations?.note) friendFields.add("friends.note");
  if (block.choiceMode === "friendField" && block.choiceFriendFieldId) {
    friendFields.add(block.choiceFriendFieldId);
  }

  for (const choice of block.choices ?? []) {
    if (block.choiceMode === "tag" && choice.tagId) tags.add(choice.tagId);
    if (block.choiceMode === "action") {
      collectActionDestinations(choice.actions, friendFields, tags);
    }
  }
}

/**
 * 一覧で「答えると何が書き換わるか」を、フォーム定義の実値から数える。
 * 同じ情報欄・タグを複数の質問で使っても、保存先としては1か所なので
 * 重複して数えない。
 */
export function summarizeFormDestinations(
  layout: FormLayout,
  onSubmitTagId: string | null,
): FormDestinationSummary {
  const friendFields = new Set<string>();
  const tags = new Set<string>();

  for (const block of collectInputs(layout)) {
    collectInputDestinations(block, friendFields, tags);
  }
  collectActionDestinations(layout.options.afterActions, friendFields, tags);
  if (onSubmitTagId) tags.add(onSubmitTagId);

  const friendFieldCount = friendFields.size;
  const tagCount = tags.size;
  return {
    friendFieldCount,
    tagCount,
    label: `友だち情報欄 ${friendFieldCount}・タグ ${tagCount}`,
  };
}

/**
 * 「情報欄に保存している」の絞り込み用。
 *
 * `label` の文言で比べない。文言が変わっても絞り込みが嘘にならないよう、
 * 保存先の数で見る。
 */
export function hasStoredDestination(
  layout: FormLayout,
  onSubmitTagId: string | null,
): boolean {
  const { friendFieldCount, tagCount } = summarizeFormDestinations(layout, onSubmitTagId);
  return friendFieldCount + tagCount > 0;
}

// ---------------------------------------------------------------------------
// 一覧の絞り込み・検索・並び替え（画面と Worker で共通の規則）
// ---------------------------------------------------------------------------

/** Convert accidental escaped line breaks and uneven whitespace into a readable title. */
export function displayFormName(name: string): string {
  return name.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

export type FormListFilter = "all" | "published" | "draft" | "stored";
export type FormListSort = "latest-answer" | "answers" | "updated" | "name";

/**
 * 一覧の1行が持つ、絞り込み・並び替えに必要な項目だけの形。
 * Worker の serializeForm 応答も画面の Form 型もこの形を満たす。
 */
export interface FormListItemLike {
  id: string;
  name: string;
  fields: Array<{ label?: unknown }>;
  layout: FormLayout;
  onSubmitTagId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  lastSubmittedAt: string | null;
  submitCount?: number;
  usedByAccounts: Array<{ name: string; count: number }>;
}

/** Answered forms come first, newest answer first. Unanswered forms stay at the bottom. */
export function sortFormsByLatestAnswer<T extends Pick<FormListItemLike, "id" | "createdAt" | "lastSubmittedAt">>(
  forms: T[],
): T[] {
  return [...forms].sort((a, b) => {
    if (a.lastSubmittedAt && b.lastSubmittedAt) {
      const latestDiff = new Date(b.lastSubmittedAt).getTime() - new Date(a.lastSubmittedAt).getTime();
      if (latestDiff !== 0) return latestDiff;
    } else if (a.lastSubmittedAt) {
      return -1;
    } else if (b.lastSubmittedAt) {
      return 1;
    }

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** 「回答数」の読み方。submitCount が無い応答では利用先の合計に落ちる。 */
export function formListAnswerCount(form: Pick<FormListItemLike, "submitCount" | "usedByAccounts">): number {
  return form.submitCount ?? form.usedByAccounts.reduce((sum, account) => sum + account.count, 0);
}

function compareDatesNewest(first: string | null | undefined, second: string | null | undefined): number {
  if (first && second) return new Date(second).getTime() - new Date(first).getTime();
  if (first) return -1;
  if (second) return 1;
  return 0;
}

/** 保存した検索（公開中 / 下書き / 情報欄に保存している）の判定。 */
export function formMatchesListFilter(form: FormListItemLike, filter: FormListFilter): boolean {
  if (filter === "published") return form.isActive;
  if (filter === "draft") return !form.isActive;
  if (filter === "stored") return hasStoredDestination(form.layout, form.onSubmitTagId);
  return true;
}

/**
 * 一覧の検索。フォーム名（表示用に整形したもの）・質問文・利用先アカウント名を
 * 小文字比較で探す。画面と Worker で同じ語彙にするため正規化もここでやる。
 */
export function formMatchesListQuery(form: FormListItemLike, rawQuery: string): boolean {
  const normalized = rawQuery.trim().toLocaleLowerCase("ja-JP");
  if (!normalized) return true;
  return (
    displayFormName(form.name).toLocaleLowerCase("ja-JP").includes(normalized)
    || form.fields.some((field) => String(field.label ?? "").toLocaleLowerCase("ja-JP").includes(normalized))
    || form.usedByAccounts.some((account) => account.name.toLocaleLowerCase("ja-JP").includes(normalized))
  );
}

/** 一覧の並び替え。既定（latest-answer）は回答が新しい順で、未回答は作成が新しい順。 */
export function sortFormListItems<T extends FormListItemLike>(forms: T[], sort: FormListSort): T[] {
  if (sort === "latest-answer") return sortFormsByLatestAnswer(forms);
  return [...forms].sort((first, second) => {
    if (sort === "answers") {
      const countDifference = formListAnswerCount(second) - formListAnswerCount(first);
      if (countDifference !== 0) return countDifference;
      return compareDatesNewest(first.updatedAt, second.updatedAt) || first.id.localeCompare(second.id);
    }
    if (sort === "updated") {
      return compareDatesNewest(first.updatedAt, second.updatedAt) || first.id.localeCompare(second.id);
    }
    return displayFormName(first.name).localeCompare(displayFormName(second.name), "ja-JP") || first.id.localeCompare(second.id);
  });
}
