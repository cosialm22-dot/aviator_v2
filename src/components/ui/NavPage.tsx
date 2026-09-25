import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

/** Full-screen page frame (iOS navigation bar with "‹ Game", centred title, optional right action). */
export default function NavPage({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-ios-bg">
      <header className="sticky top-0 z-20 grid h-11 grid-cols-[1fr_auto_1fr] items-center bg-ios-bg/80 backdrop-blur-xl backdrop-saturate-150">
        <Link to="/" className="flex h-11 items-center justify-self-start pl-2 pr-3 text-body text-ios-green active:opacity-60" aria-label="Back to game">
          <ChevronLeft size={28} strokeWidth={2.2} className="-mr-0.5" />Game
        </Link>
        <span className="text-headline text-white">{title}</span>
        <div className="justify-self-end pr-2">{action}</div>
      </header>
      <div className="mx-auto max-w-xl pb-[calc(32px+env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );
}
