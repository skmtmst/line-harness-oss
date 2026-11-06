// 内部から自分の公開入口を読み戻さず、実装の依存先を直接読む。
export { buildQuestionMessages, parseQuestion, parseQuestionPostback } from '../scenario-question.js';
export type { ScenarioQuestion } from '../scenario-question.js';
