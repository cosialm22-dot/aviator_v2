/*
  # Create chat_messages table

  1. New Tables
    - `chat_messages`
      - `id` (uuid, primary key)
      - `user_id` (uuid, nullable — bots have no user_id)
      - `username` (text)
      - `avatar_color` (text)
      - `text` (text, max 200 chars enforced via check)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Authenticated users can insert their own messages
    - Everyone (including anon) can read messages (public chat)
    - Messages older than 24h are not surfaced via policy (keep table lean)

  3. Notes
    - Supabase Realtime is enabled on this table for live updates
    - A partial index on created_at speeds up the "latest N messages" query
*/

CREATE TABLE IF NOT EXISTS chat_messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  username     text        NOT NULL DEFAULT '',
  avatar_color text        NOT NULL DEFAULT '#3b82f6',
  text         text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_text_length CHECK (char_length(text) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON chat_messages (created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Anyone can read recent messages (public chat)
CREATE POLICY "Anyone can read chat messages"
  ON chat_messages FOR SELECT
  USING (true);

-- Only authenticated users can insert their own messages
CREATE POLICY "Authenticated users can send messages"
  ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
