import { api } from '../../api'
/** シナリオ開始を複数追加するときも既存の共通アクションを使い、公開版を配信へ固定する。 */
export const broadcastAfterActionsApi={
 resources:api.commonActions.resources,
 createDraft:api.commonActions.create,
 updateDraft:api.commonActions.updateDraft,
 publish:api.commonActions.publish,
 detail:api.commonActions.get,
}
