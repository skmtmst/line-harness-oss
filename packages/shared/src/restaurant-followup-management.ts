/** 一般の詳細画面にも、来店フォローの管理元と実際に送れる状態を伝える。 */
export interface RestaurantFollowupManagement {
 storeId:string;
 storeName:string;
 effectiveSendingStatus:'active'|'stopped';
 reason:string|null;
 path:string;
}
