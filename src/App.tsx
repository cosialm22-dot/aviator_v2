import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Header from './components/layout/Header';
import AviatorGame from './components/game/AviatorGame';
import { useAuth } from './hooks/useAuth';
import { useWallet } from './hooks/useWallet';
import { useBonus } from './hooks/useBonus';
import { useDemoGame } from './hooks/useDemoGame';
import { StreamerModeProvider } from './hooks/useStreamerMode';

// The operator admin panel is a large, role-gated surface that the vast majority
// of visitors (players) never load. Code-splitting it keeps the player bundle
// lean and only fetches admin chunks when an operator navigates to /admin.
const AdminApp = lazy(() => import('./admin/AdminApp'));
// Everything that is not the game screen loads on demand, so the first paint of the game only
// downloads the game. The modals are prefetched once the browser is idle, so opening them later
// is instant.
const loadAuthModal = () => import('./components/auth/AuthModal');
const loadWalletModal = () => import('./components/wallet/WalletModal');
const ProfilePage = lazy(() => import('./components/profile/ProfilePage'));
const MarketerHub = lazy(() => import('./components/marketer/MarketerHub'));
const AuthModal = lazy(loadAuthModal);
const WalletModal = lazy(loadWalletModal);

function usePrefetchOnIdle() {
  useEffect(() => {
    const run = () => { void loadAuthModal(); void loadWalletModal(); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(run, { timeout: 4000 }); return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id); }
    const t = setTimeout(run, 2500);
    return () => clearTimeout(t);
  }, []);
}

type AuthMode = 'signin' | 'signup' | null;
export type PlayMode = 'real' | 'demo';

function PlayerApp() {
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  // Real vs Demo play mode. Lifted here so the header balance and the game share one source.
  const [mode, setMode] = useState<PlayMode>('real');
  usePrefetchOnIdle();

  const { user, profile, wallet, loading, signUp, signIn, signOut, refreshWallet } = useAuth();
  const { deposit, withdraw, depositing, withdrawing } = useWallet(user?.id, refreshWallet);
  const { activeLocked, eligibleForFirstDeposit } = useBonus(user?.id);

  // The demo engine only makes sense on the game screen.
  // Off the game route (e.g. /profile, /marketer) the rigged loop is paused so
  // it never burns a rAF in the background.
  const { pathname } = useLocation();
  const onGameRoute = pathname === '/' || pathname === '';

  // Self-contained, rigged, client-only demo engine (no DB writes). Always
  // mounted so its play-money balance persists across mode toggles; it only runs
  // its round loop while `active`. Demo bets are attributed to the player's name
  // when signed in, otherwise to a neutral guest identity.
  const demo = useDemoGame({
    active: mode === 'demo' && onGameRoute,
    playerName: profile?.username ?? 'You',
    playerColor: profile?.avatar_color ?? '#22c55e',
  });

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#0e0e0e]" role="status" aria-label="Loading">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-danger border-t-transparent" />
      </div>
    );
  }

  const openDeposit = () => {
    if (!profile) { setAuthMode('signup'); return; }
    setWalletOpen(true);
  };

  return (
    <StreamerModeProvider role={profile?.role}>
    <div className="h-[100dvh] bg-[#0e0e0e] flex flex-col overflow-hidden">
      <Header
        profile={profile}
        balance={wallet?.balance ?? 0}
        mode={mode}
        onSetMode={setMode}
        demoBalance={mode === 'demo' && onGameRoute ? demo.balance : null}
        onDemoReset={demo.reset}
        busy={depositing ? 'deposit' : withdrawing ? 'withdraw' : null}
        onSignInOpen={() => setAuthMode('signin')}
        onRegisterOpen={() => setAuthMode('signup')}
        onWalletOpen={() => setWalletOpen(true)}
        onSignOut={signOut}
      />

      <main className="flex-1 min-h-0 overflow-hidden">
        <Routes>
          <Route
            index
            element={
              <AviatorGame
                profile={profile}
                wallet={wallet}
                mode={mode}
                demo={demo}
                onAuthRequired={() => setAuthMode('signup')}
                onRefreshWallet={refreshWallet}
                onDepositOpen={openDeposit}
              />
            }
          />
          <Route
            path="profile"
            element={
              <Suspense fallback={<InlineFallback />}>
                <ProfilePage
                  user={user}
                  profile={profile}
                  wallet={wallet}
                  onSignInRequired={() => setAuthMode('signin')}
                />
              </Suspense>
            }
          />
          <Route
            path="marketer"
            element={
              <Suspense fallback={<InlineFallback />}>
                <MarketerHub
                  profile={profile}
                  onSignInRequired={() => setAuthMode('signin')}
                />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {authMode && (
        <Suspense fallback={null}>
        <AuthModal
          initialMode={authMode}
          onSignUp={signUp}
          onSignIn={signIn}
          onClose={() => setAuthMode(null)}
        />
        </Suspense>
      )}

      {walletOpen && wallet && (
        <Suspense fallback={null}>
        <WalletModal
          balance={wallet.balance}
          onDeposit={deposit}
          onWithdraw={withdraw}
          onClose={() => setWalletOpen(false)}
          eligibleForFirstDeposit={eligibleForFirstDeposit}
          activeBonus={activeLocked}
          defaultPhone={user?.phone}
        />
        </Suspense>
      )}

    </div>
    </StreamerModeProvider>
  );
}

function InlineFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-win border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// Shown while the lazily-loaded admin chunk is fetched.
function RouteFallback() {
  return (
    <div className="min-h-[100dvh] bg-night flex items-center justify-center">
      <div className="w-10 h-10 border-2 border-win border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<RouteFallback />}>
            <AdminApp />
          </Suspense>
        }
      />
      <Route path="/*" element={<PlayerApp />} />
    </Routes>
  );
}
