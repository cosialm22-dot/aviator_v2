// Shared inline spinner for admin buttons/actions. Inherits the current text
// colour (border-current) so it matches whatever button it sits inside.
// Previously duplicated byte-for-byte across every admin page.
export function Spin() {
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />;
}
