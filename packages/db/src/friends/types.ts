
export interface Friend {
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  status_message: string | null;
  is_following: number;
  is_hidden?: number;
  first_followed_at?: string | null;
  current_follow_started_at?: string | null;
  last_followed_at?: string | null;
  last_unfollowed_at?: string | null;
  unfollow_count?: number;
  user_id: string | null;
  line_account_id: string | null;
  metadata: string;
  first_tracked_link_id: string | null;
  created_at: string;
  updated_at: string;
}
