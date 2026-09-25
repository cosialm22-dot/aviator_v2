// Shown on a brand's own domain while the brand is suspended or disabled.
export default function BrandUnavailable({ name }: { name: string }) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-2 bg-g-bg px-6 text-center" data-testid="brand-unavailable">
      <p className="font-title text-title2 text-g-fg">{name}</p>
      <p className="text-subhead text-g-mute">This site is not available right now.</p>
    </div>
  );
}
