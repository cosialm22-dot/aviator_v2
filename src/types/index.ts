export type GameStatus = 'idle' | 'waiting' | 'flying' | 'crashed';

export type BetStatus = 'active' | 'won' | 'lost' | 'cashedout';

export type UserRole = 'player' | 'marketer' | 'admin' | 'super_admin';

export interface Profile {
  id: string;
  username: string;
  avatar_color: string;
  // Present at runtime (profiles are fetched with select('*')). Drives the
  // operator play-restriction: only 'player' and 'marketer' may wager; admins
  // and super_admins are operators and must not place bets (mirrors the DB
  // place_bet guard and the block_operator_bets trigger).
  role?: UserRole;
}

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  currency: string;
}

export interface GameRound {
  id: string;
  round_number: number | null;
  crash_multiplier: number;
  status: GameStatus;
  started_at: string | null;
  crashed_at: string | null;
  created_at: string;
}

export interface Bet {
  id: string;
  round_id: string;
  user_id: string | null;
  username: string;
  avatar_color: string;
  amount: number;
  cashout_multiplier: number | null;
  winnings: number | null;
  status: BetStatus;
  is_bot: boolean;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'bet' | 'win';
  amount: number;
  payment_method: string | null;
  reference: string | null;
  description: string | null;
  status: string;
  created_at: string;
}

export interface BotPlayer {
  id: string;
  username: string;
  avatar_color: string;
  betAmount: number;
  cashoutAt: number | null;
  hasBet: boolean;
  hasCashedOut: boolean;
}
