
export interface RestaurantEvent {
 id:string; reservation_id:string|null;store_id:string;event_type:string;reservation_version:number;
 occurred_at:string;request_id:string;line_account_id:string|null;friend_id:string|null;payload_json:string;
}
