/** 1行の送り手は1つ。新しい実物へ切り替えた行では旧bindingを数えない。 */
export const restaurantFollowupEnabledRowsSql=`
 SELECT store_id,trigger FROM rt_store_followup_targets WHERE engine IN('reminder','automation') AND enabled=1
 UNION
 SELECT b.store_id,b.trigger FROM rt_store_followup_step_bindings b WHERE b.enabled=1
   AND NOT EXISTS(SELECT 1 FROM rt_store_followup_targets ft WHERE ft.store_id=b.store_id AND ft.trigger=b.trigger AND ft.engine IN('reminder','automation'))`;
