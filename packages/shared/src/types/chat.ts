// -----------------------------------------------------------------------------
// オペレーター (Operator)
// -----------------------------------------------------------------------------

export interface Operator {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// チャット (Chat)
// -----------------------------------------------------------------------------

export interface Chat {
  id: string;
  friendId: string;
  operatorId: string | null;
  status: "unread" | "in_progress" | "on_hold" | "resolved";
  notes: string | null;
  revision: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}
