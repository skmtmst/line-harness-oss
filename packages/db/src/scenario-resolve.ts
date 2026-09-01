export interface StepLike {
  template_id: string | null;
  message_type: string;
  message_content: string;
  question_json?: string | null;
}

export interface ResolvedContent {
  messageType: string;
  messageContent: string;
  /** 実際に配信時に使った template_id (null = step 直接値を使った) */
  templateIdAtSend: string | null;
  /** 質問テンプレートなら、その時点の質問。通常テンプレートは step の控え。 */
  questionJson: string | null;
}

/**
 * テンプレ message_type を scenario_steps の CHECK 制約 ('text','image','flex') に
 * 合わせて正規化する。templates テーブルには 'carousel' も存在するが、scenario の
 * buildMessage() は text/image/flex しか扱えないため flex (carousel は Flex の特殊形)
 * に coerce する。
 */
function normalizeMessageType(type: string): string {
  /*
   * 以前は carousel を flex に寄せていたが、**別物**だった。
   * カルーセルの中身は columns の配列で、Flex が要求するのは bubble か
   * carousel のオブジェクト。配列を渡すと LINE が 400 を返し、400 は
   * 永続エラー扱いなので、その人の購読ごと止まっていた。
   *
   * carousel のまま返し、buildMessage が template メッセージに組み立てる。
   */
  return type;
}

/**
 * step.template_id がセットされていれば templates テーブルから内容を resolve。
 * テンプレが見つからない (削除直後のレース等) は step 側にフォールバックして配信を止めない。
 */
export async function resolveStepContent(
  db: D1Database,
  step: StepLike,
): Promise<ResolvedContent> {
  if (!step.template_id) {
    return {
      messageType: step.message_type,
      messageContent: step.message_content,
      templateIdAtSend: null,
      questionJson: step.question_json ?? null,
    };
  }
  const tpl = await db
    .prepare('SELECT message_type, message_content, question_json FROM templates WHERE id = ?')
    .bind(step.template_id)
    .first<{ message_type: string; message_content: string; question_json: string | null }>();
  if (!tpl) {
    return {
      messageType: step.message_type,
      messageContent: step.message_content,
      templateIdAtSend: null,
      questionJson: step.question_json ?? null,
    };
  }
  return {
    messageType: normalizeMessageType(tpl.message_type),
    messageContent: tpl.message_content,
    templateIdAtSend: step.template_id,
    questionJson: tpl.question_json ?? step.question_json ?? null,
  };
}
