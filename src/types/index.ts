export type GameStatus = 'idle' | 'waiting' | 'flying' | 'crashed';

export type BetStatus = 'active' | 'won' | 'lost' | 'cashedout';

export interface Profile {
  id: string;
  username: string;
  avatar_color: string;
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
