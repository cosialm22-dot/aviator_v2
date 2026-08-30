import { useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Header from './components/layout/Header';
import AviatorGame from './components/game/AviatorGame';
import ProfilePage from './components/profile/ProfilePage';
import MarketerHub from './components/marketer/MarketerHub';
import AuthModal from './components/auth/AuthModal';
import WalletModal from './components/wallet/WalletModal';
import DemoNudgeToast from './components/game/DemoNudgeToast';
import { useAuth } from './hooks/useAuth';
import { useWallet } from './hooks/useWallet';
import { useBonus } from './hooks/useBonus';
import { useDemoGame } from './hooks/useDemoGame';
import { useDemoNudges } from './hooks/useDemoNudges';
import { StreamerModeProvider } from './hooks/useStreamerMode';

// The operator admin panel is a large, role-gated surface that the vast majority
// of visitors (players) never load. Code-splitting it keeps the player bundle
// lean and only fetches admin chunks when an operator navigates to /admin.
const AdminApp = lazy(() => import('./admin/AdminApp'));

type AuthMode = 'signin' | 'signup' | null;
export type PlayMode = 'real' | 'demo';

function PlayerApp() {
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  // Real vs Demo play mode. Lifted here so the header switch, the game, and the
  // conversion toast all share one source of truth.
  const [mode, setMode] = useState<PlayMode>('real');

  const { user, profile, wallet, loading, signUp, signIn, signOut, refreshWallet } = useAuth();
  const { deposit, withdraw, depositing, withdrawing } = useWallet(user?.id, refreshWallet);
  const { activeLocked, eligibleForFirstDeposit } = useBonus(user?.id);

  // The demo engine (and its nudges/toast) only make sense on the game screen.
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
  const nudges = useDemoNudges({ active: mode === 'demo' && onGameRoute, lastWin: demo.lastWin, roundsPlayed: demo.roundsPlayed });

  if (loading) {
    return (
      <div className="min-h-screen bg-night flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-danger border-t-transparent rounded-full animate-spin" />
          <div className="text-slate-400 text-sm font-medium">Loading Aviator...</div>
        </div>
      </div>
    );
  }

  const openDeposit = () => {
    if (!profile) { setAuthMode('signup'); return; }
    setWalletOpen(true);
  };

  // CTA from a demo nudge: leave demo and, if not signed in, prompt sign-up.
  const playForReal = () => {
    setMode('real');
    if (!profile) setAuthMode('signup');
  };

  return (
    <StreamerModeProvider role={profile?.role}>
    <div className="h-[100dvh] bg-night flex flex-col overflow-hidden">
      <Header
        profile={profile}
        balance={wallet?.balance ?? 0}
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
                onSetMode={setMode}
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
              <ProfilePage
                user={user}
                profile={profile}
                wallet={wallet}
                onSignInRequired={() => setAuthMode('signin')}
              />
            }
          />
          <Route
            path="marketer"
            element={
              <MarketerHub
                profile={profile}
                onSignInRequired={() => setAuthMode('signin')}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {mode === 'demo' && onGameRoute && (
        <DemoNudgeToast nudge={nudges.current} onPlayReal={playForReal} onDismiss={nudges.dismiss} />
      )}

      {authMode && (
        <AuthModal
          initialMode={authMode}
          onSignUp={signUp}
          onSignIn={signIn}
          onClose={() => setAuthMode(null)}
        />
      )}

      {walletOpen && wallet && (
        <WalletModal
          balance={wallet.balance}
          onDeposit={deposit}
          onWithdraw={withdraw}
          onClose={() => setWalletOpen(false)}
          eligibleForFirstDeposit={eligibleForFirstDeposit}
          activeBonus={activeLocked}
        />
      )}

      {walletOpen && !wallet && profile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-night border border-edge rounded-2xl p-6 text-white text-center">
            <p className="text-slate-400 mb-4">Loading wallet...</p>
            <button onClick={() => setWalletOpen(false)} className="px-4 py-2 bg-danger rounded-lg text-sm">Close</button>
          </div>
        </div>
      )}

      {(depositing || withdrawing) && (
        <div className="fixed bottom-4 right-4 bg-night border border-edge rounded-xl px-4 py-3 flex items-center gap-3 shadow-2xl z-50">
          <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-white text-sm font-medium">
            {depositing ? 'Processing deposit...' : 'Processing withdrawal...'}
          </span>
        </div>
      )}
    </div>
    </StreamerModeProvider>
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
