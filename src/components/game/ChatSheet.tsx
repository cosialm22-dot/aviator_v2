import Chat from './Chat';
import Sheet from '../ui/Sheet';
import { useChatStream } from '../../hooks/useChatStream';
import type { Profile } from '../../types';

// The chat stream (history fetch, realtime channel, bot timer) runs only while this is open.
export default function ChatSheet({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const chat = useChatStream({ userId: profile?.id, username: profile?.username, avatarColor: profile?.avatar_color });
  return (
    <Sheet title="Chat" onClose={onClose} className="h-[85dvh] sm:h-[70vh]">
      <Chat messages={chat.messages} sending={chat.sending} onSend={chat.send} userId={profile?.id} username={profile?.username} />
    </Sheet>
  );
}
