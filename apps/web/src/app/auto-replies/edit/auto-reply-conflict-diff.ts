import type { WizardForm } from './wizard-v8'

/**
 * 自動応答の編集競合（409）の「違いを比べる」で出す差分。
 *
 * 自分の下書きと、相手が保存した最新の版を手順ごとに比べる。
 * 版の履歴APIは無いので、読み直す前に最新を1回取ってその場で比べる。
 * 細かい1件ずつは追わず、手順の名前で言う（嘘の行は出さない）。
 */

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function basicOf(form: WizardForm): unknown {
  return { ruleName: form.ruleName, folderId: form.folderId, internalMemo: form.internalMemo }
}

function triggerOf(form: WizardForm): unknown {
  return {
    respondToAll: form.respondToAll,
    keywordRules: form.keywordRules,
    keywordMatchMode: form.keywordMatchMode,
    matchType: form.matchType,
    messageKinds: form.messageKinds,
    weekdays: form.weekdays,
    holidayRule: form.holidayRule,
    timeMode: form.timeMode,
    activeFrom: form.activeFrom,
    activeUntil: form.activeUntil,
    friendTarget: form.friendTarget,
    friendConditions: form.friendConditions,
  }
}

function responseOf(form: WizardForm): unknown {
  return {
    mode: form.mode,
    templateId: form.templateId,
    responseContent: form.responseContent,
    actions: form.actions,
    replyDelaySeconds: form.replyDelaySeconds,
    cooldownOn: form.cooldownOn,
    cooldownMinutes: form.cooldownMinutes,
    skipWhenOperatorActive: form.skipWhenOperatorActive,
    oncePerFriend: form.oncePerFriend,
    unmatchedMode: form.unmatchedMode,
    receiveSources: form.receiveSources,
  }
}

/** 変わった手順の名前を順に返す。同じなら空。 */
export function describeAutoReplyDiff(mine: WizardForm, incoming: WizardForm): string[] {
  const lines: string[] = []
  if (mine.ruleName !== incoming.ruleName) {
    lines.push(
      `ルール名が違います（最新「${incoming.ruleName || '（無題）'}」／あなた「${mine.ruleName || '（無題）'}」）`,
    )
  } else if (!sameJson(basicOf(mine), basicOf(incoming))) {
    lines.push('基本設定（フォルダ・メモ）が違います')
  }
  if (!sameJson(triggerOf(mine), triggerOf(incoming))) {
    lines.push('「どんなときに動くか」（言葉・曜日・時間帯・相手）が違います')
  }
  if (!sameJson(responseOf(mine), responseOf(incoming))) {
    lines.push('「何を返すか」（返信・処理・間隔）が違います')
  }
  if (mine.priority !== incoming.priority) {
    lines.push('優先順位が違います')
  }
  return lines
}
