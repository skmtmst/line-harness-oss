import { messageKindProblem, type MessageKind, type MessageKindState } from '@/components/scenarios/message-kind-fields'
import { deadAnswerSettings, isUriOnlyBehavior, validateChoiceUris } from '@/components/scenarios/question-editor'
import { isDeliveryTimeSet } from '@/components/scenarios/step-preview'
import { findInvalidRangeIssue } from '@/components/shared/condition-builder'
import type { DeliveryMode } from '@line-crm/shared'
import { isStructuredKind, type StepFormState } from './detail-model'

export type ScenarioStepProblem = {
  field: 'question' | 'content' | 'template' | 'time' | null
  message: string
  cause?: unknown
}

/** 質問・直書き・テンプレートを別々に検査し、入力は書き換えない。 */
export function validateScenarioStep(stepForm: StepFormState, kindState: MessageKindState, deliveryMode: DeliveryMode): ScenarioStepProblem | null {
    /*
     * SCENARIO-21: 質問・直接入力・テンプレートはそれぞれ独立して検査する。
     * 以前は質問がある通も else に流れてテンプレート必須判定にかかり、
     * 直接作った質問が保存できなかった。
     */
    if (stepForm.question) {
      if (!stepForm.question.text.trim()) {
        return { field: 'question', message: '質問文を入力してください' }
      }
      if (stepForm.question.choices.length === 0 || stepForm.question.choices.some((choice) => !choice.label.trim())) {
        return { field: 'question', message: 'すべての選択肢に文字を入力してください' }
      }
      /*
       * SCENARIO-22: URLなどを開くだけの挙動に、届かない通知を待つ設定
       * （返信・タグ・友だち情報）が残っていると保存を止める。消すか
       * 「何もしない」に変えるかは本人に選ばせ、黙って消さない。
       */
      const deadIndex = stepForm.question.choices.findIndex(
        (choice) => isUriOnlyBehavior(choice.behavior) && deadAnswerSettings(choice).length > 0,
      )
      if (deadIndex >= 0) {
        const dead = deadAnswerSettings(stepForm.question.choices[deadIndex])
        return { field: 'question', message: `選択肢${deadIndex + 1}はURLなどを開くだけの挙動のため、設定されている${dead.join('・')}は実行されません。設定を消すか、挙動を「何もしない」に変えてください。` }
      }
      /*
       * R214: 行き先（URL・電話・メール）の形を見る。not-a-url のような
       * 値でも保存できると、設定済みに見えて実際は開けない通になる。
       * 下書きでも通さず、その場で直せるよう選択肢番号で名指しする。
       */
      const uriError = validateChoiceUris(stepForm.question)
      if (uriError) {
        return { field: 'question', message: uriError }
      }
    } else if (stepForm.inputMode === 'direct') {
      // 直接入力モード: messageContent 必須 + Flex/画像 は JSON parse 検証
      if (!stepForm.messageContent.trim()) {
        /*
         * R234: 専用欄（音声・スタンプなど）で「入っているが送れない」値の
         * ときは、どこが悪いかをはっきり言う。「入力してください」だけだと
         * 空欄と区別がつかず、足しても足しても通らない。
         */
        if (isStructuredKind(stepForm.messageType)) {
          const problem = messageKindProblem(stepForm.messageType as MessageKind, kindState)
          if (problem) {
            return { field: 'content', message: problem }
          }
        }
        return { field: 'content', message: 'メッセージ内容を入力してください' }
      }
      if (stepForm.messageType === 'flex' || stepForm.messageType === 'image') {
        try {
          JSON.parse(stepForm.messageContent)
        } catch (saveFailure) {

          return { field: 'content', message: stepForm.messageType === 'flex'
              ? 'Flex メッセージの JSON が不正です'
              : '画像メッセージの JSON が不正です', cause: saveFailure }
        }
      }
    } else {
      if (!stepForm.templateId) {
        return { field: 'template', message: 'テンプレートを選択してください' }
      }
    }
    /*
     * R235: 時刻指定なのに時刻が空のまま送ると、サーバーが 400 で断る。
     * 投げる前に時刻の欄へ戻す。時刻の欄の場所（「購読開始から ○日後の
     * ○に配信」）も文に入れ、どこを直すか分かるようにする。
     */
    if (deliveryMode === 'absolute_time' && !isDeliveryTimeSet(stepForm.schedule.deliveryTime)) {
      return { field: 'time', message: '配信する時刻を入力してください（「購読開始から ○日後の ○に配信」の時刻の欄）' }
    }
    /*
     * R247: 1通の配信条件の不正範囲（上下限の逆転など）は落とさず、
     * 欄の下で知らせて止める。保存済みの条件は維持する。
     */
    const rangeIssue = findInvalidRangeIssue(stepForm.targetCondition ?? null)
    if (rangeIssue) {
      return { field: null, message: rangeIssue }
    }
  return null
}
