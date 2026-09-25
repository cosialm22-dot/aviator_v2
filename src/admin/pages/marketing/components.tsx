import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { StatCard as KitStatCard } from '../../ui/kit';
import { TabActionsSlot } from './shared';

// Small presentational components for the admin Marketing hub. Component-only
// module (Fast-Refresh friendly); pure helpers live in ./shared.

export { Spin } from '../../components/Spin';

export function StatCard({ label, value }: { label: string; value: string }) {
  return <KitStatCard label={label} value={value} />;
}

/** Renders a tab's actions (Refresh, New …) at the right end of the Marketing tab bar. */
export function TabActions({ children }: { children: ReactNode }) {
  const slot = useContext(TabActionsSlot);
  return slot ? createPortal(children, slot) : <div className="flex justify-end gap-2">{children}</div>;
}
