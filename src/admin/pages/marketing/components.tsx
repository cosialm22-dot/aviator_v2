import { HEAD } from './shared';

// Small presentational components for the admin Marketing hub. Component-only
// module (Fast-Refresh friendly); pure helpers live in ./shared.

export function Spin() {
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />;
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className={HEAD}>{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink tabular-nums">{value}</div>
    </div>
  );
}
