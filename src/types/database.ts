export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          avatar_color: string;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          avatar_color?: string;
          created_at?: string;
        };
        Update: {
          username?: string;
          avatar_color?: string;
        };
      };
      wallets: {
        Row: {
          id: string;
          user_id: string;
          balance: number;
          currency: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          balance?: number;
          currency?: string;
        };
        Update: {
          balance?: number;
          updated_at?: string;
        };
      };
      game_rounds: {
        Row: {
          id: string;
          round_number: number | null;
          crash_multiplier: number;
          status: string;
          started_at: string | null;
          crashed_at: string | null;
          created_at: string;
        };
        Insert: {
          round_number?: number | null;
          crash_multiplier: number;
          status?: string;
          started_at?: string | null;
          crashed_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: string;
          started_at?: string | null;
          crashed_at?: string | null;
        };
      };
      bets: {
        Row: {
          id: string;
          round_id: string;
          user_id: string | null;
          username: string;
          avatar_color: string;
          amount: number;
          cashout_multiplier: number | null;
          winnings: number | null;
          status: string;
          is_bot: boolean;
          created_at: string;
        };
        Insert: {
          round_id: string;
          user_id?: string | null;
          username: string;
          avatar_color?: string;
          amount: number;
          cashout_multiplier?: number | null;
          winnings?: number | null;
          status?: string;
          is_bot?: boolean;
          created_at?: string;
        };
        Update: {
          cashout_multiplier?: number | null;
          winnings?: number | null;
          status?: string;
        };
      };
      transactions: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          amount: number;
          payment_method: string | null;
          reference: string | null;
          description: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          type: string;
          amount: number;
          payment_method?: string | null;
          reference?: string | null;
          description?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          status?: string;
        };
      };
    };
  };
}
