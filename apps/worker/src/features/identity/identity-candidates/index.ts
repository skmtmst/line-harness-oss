// 不要な操作まで初期化しないよう、操作単位の公開入口を分ける。
export { IdentityCandidateError, candidateAccountIds, decideIdentityCandidate, getIdentityCandidate, listIdentityCandidates, undoIdentityCandidate, upsertIdentityCandidate } from '../identity-candidates.js';
export type { IdentityCandidateDraft } from '../identity-candidates.js';
