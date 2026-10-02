/*
 * シナリオの複製（★V8 一覧の「…→複製する」と詳細画面の「複製」で共用する手順）。
 *
 * 一覧からの複製は ★V8 の複製ダイアログ（`Al4Ek`）が入口。
 * 詳細画面（scenario-detail-client.tsx）には同じ手順がまだ内蔵されており、
 * 途中止まりの続きから再開する（duplicateRemainder）まで担っている。
 * 一覧は新しい入口なので「作りかけを続きから」は持たず、止まったら
 * どこで止まったかを DuplicateAborted で伝える。
 *
 * 手順は詳細画面と同じ：
 *   1. 止めた状態のコピーを作る（isActive: false）
 *   2. 配信対象・終了後の処理を update で写す（create は受けない）
 *   3. 通を順に足す（まとめて入れる口が無い。時刻は方式に合う欄だけ送る）
 *   4. 開始のきっかけを写す
 *   5. アクションを写す（通にぶら下がるものは写した先の通へ張り替える）
 */
import type { DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { SegmentCondition } from '@/components/shared/condition-builder'
import type { ScenarioQuestion } from '@/components/scenarios/question-editor'

/** 複製が途中で止まったことを、作りかけのコピーと一緒に運ぶ印。 */
export class DuplicateAborted extends Error {
  constructor(
    /** 途中まで作成されたコピーのID（一覧には残る）。 */
    readonly copyId: string,
    /** どの段階で止まったか（運用者の言葉）。 */
    readonly stage: string,
    cause?: unknown,
  ) {
    super(cause instanceof Error && cause.message ? cause.message : '複製できませんでした')
  }
}

/*
 * 複製で送る時刻の欄は、配信方式ごとに必要なものだけにする。
 * 全部送ると口（validateStepSchedule）が余分な欄を見て 400 で止める
 * （詳細画面の stepScheduleForClone と同じ分け方）。
 */
function stepScheduleForClone(
  mode: DeliveryMode,
  step: { delayMinutes?: number | null; offsetDays?: number | null; offsetMinutes?: number | null; deliveryTime?: string | null },
): { delayMinutes?: number; offsetDays?: number; offsetMinutes?: number; deliveryTime?: string } {
  if (mode === 'relative') return { delayMinutes: step.delayMinutes ?? undefined }
  if (mode === 'elapsed') {
    return {
      offsetDays: step.offsetDays ?? 0,
      offsetMinutes: step.offsetMinutes ?? 0,
    }
  }
  return {
    offsetDays: step.offsetDays ?? 0,
    deliveryTime: step.deliveryTime ?? '09:00',
  }
}

/**
 * シナリオを丸ごと複製し、作ったコピーのIDを返す。
 *
 * @param sourceId 写す元のシナリオID
 * @param copyName コピーの名前（呼び出し側のダイアログが決める）
 */
export async function duplicateScenario(sourceId: string, copyName: string): Promise<string> {
  const source = await api.scenarios.get(sourceId)
  if (!source.success) throw new Error(source.error)
  const scenario = source.data
  const steps = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const mode = scenario.deliveryMode ?? 'relative'

  // 1. 止めた状態のコピーを作る。作った直後に配信が始まると、確かめる前に届く。
  const created = await api.scenarios.create({
    name: copyName,
    description: scenario.description,
    triggerType: scenario.triggerType,
    triggerTagId: scenario.triggerTagId,
    lineAccountId: scenario.lineAccountId,
    isActive: false,
    deliveryMode: scenario.deliveryMode,
    allowConcurrent: scenario.allowConcurrent,
    folderId: scenario.folderId ?? null,
  })
  if (!created.success) throw new Error(created.error)
  const copyId = created.data.id

  // 2. 配信対象・終了後の処理。create は受けないので直後の update で入れる。
  try {
    const updated = await api.scenarios.update(copyId, {
      audienceCondition: scenario.audienceCondition ?? null,
      onCompleteMode: scenario.onCompleteMode ?? 'pause',
      onCompleteScenarioId: scenario.onCompleteScenarioId ?? null,
    })
    if (!updated.success) throw new Error(updated.error)
  } catch (cause) {
    throw new DuplicateAborted(copyId, 'シナリオ全体の設定（配信対象・終了後の処理）', cause)
  }

  // 3. 通を順に足す。途中で止めて通が欠けた別物の流れを残さない。
  const stepIdMap = new Map<string, string>()
  for (const step of steps) {
    const copied = await api.scenarios
      .addStep(copyId, {
        stepOrder: step.stepOrder,
        ...stepScheduleForClone(mode, step),
        messageType: step.messageType,
        messageContent: step.messageContent,
        templateId: step.templateId ?? null,
        onReachTagId: step.onReachTagId ?? null,
        // 複製先でも同じところで止まる。止まる位置が変わると流れが別物になる。
        afterSend: step.afterSend ?? 'continue',
        targetCondition: (step.targetCondition as SegmentCondition | null) ?? null,
        question: (step.question as ScenarioQuestion | null) ?? null,
        isDraft: step.isDraft === true,
      })
      .catch((cause) => ({
        success: false as const,
        error: cause instanceof Error && cause.message ? cause.message : '通をコピーできませんでした',
      }))
    if (!copied.success) {
      throw new DuplicateAborted(copyId, `${step.stepOrder}通目のコピー`, new Error(copied.error))
    }
    stepIdMap.set(step.id, copied.data.id)
  }

  // 4. 開始のきっかけ。写さないと「複製したのに始まらない」コピーになる。
  try {
    const [sourceTriggers, copyTriggers] = await Promise.all([
      api.scenarios.triggers.list(sourceId),
      api.scenarios.triggers.list(copyId),
    ])
    if (!sourceTriggers.success) throw new Error(sourceTriggers.error)
    if (!copyTriggers.success) throw new Error(copyTriggers.error)
    const have = new Set(copyTriggers.data.map((t) => `${t.kind}:${t.tagId ?? ''}`))
    for (const trigger of sourceTriggers.data) {
      if (have.has(`${trigger.kind}:${trigger.tagId ?? ''}`)) continue
      const added = await api.scenarios.triggers.add(copyId, trigger.kind, trigger.tagId)
      if (!added.success) throw new Error(added.error)
    }
  } catch (cause) {
    throw new DuplicateAborted(copyId, '開始のきっかけ', cause)
  }

  // 5. アクション。通にぶら下がるものは写した先の通へ張り替える。
  try {
    const [sourceActions, copyActions] = await Promise.all([
      api.scenarios.actions.list(sourceId),
      api.scenarios.actions.list(copyId),
    ])
    if (!sourceActions.success) throw new Error(sourceActions.error)
    if (!copyActions.success) throw new Error(copyActions.error)
    const keyOf = (
      hook: string,
      stepId: string | null,
      choiceIndex: number | null,
      actionType: string,
      sortOrder: number,
    ) => `${hook}:${stepId ?? ''}:${choiceIndex ?? ''}:${actionType}:${sortOrder}`
    const have = new Set(
      copyActions.data.map((a) => keyOf(a.hook, a.stepId, a.choiceIndex, a.actionType, a.sortOrder)),
    )
    for (const action of sourceActions.data) {
      const mappedStepId = action.stepId === null ? null : stepIdMap.get(action.stepId) ?? null
      if (action.stepId !== null && mappedStepId === null) {
        // 写せなかった通にぶら下がるアクションは足さない。
        continue
      }
      const key = keyOf(action.hook, mappedStepId, action.choiceIndex, action.actionType, action.sortOrder)
      if (have.has(key)) continue
      const createdAction = await api.scenarios.actions.create(copyId, {
        hook: action.hook,
        stepId: mappedStepId,
        choiceIndex: action.choiceIndex,
        actionType: action.actionType,
        config: action.config,
        condition: action.condition,
        repeatOnRefire: action.repeatOnRefire,
        sortOrder: action.sortOrder,
      })
      if (!createdAction.success) throw new Error(createdAction.error)
      have.add(key)
    }
  } catch (cause) {
    throw new DuplicateAborted(copyId, 'アクション', cause)
  }

  return copyId
}
