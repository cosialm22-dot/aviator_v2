import { useId, useMemo } from 'react';
import { planeSvg, PLANE_MAP } from '../../brand/planes';

// PlaneMark — the brand's plane as a small static mark (header, admin cards, previews). Uses the
// same vector layers as the game canvas, so the header plane is exactly the plane that flies.
// "classic" shows the original red sprite; "custom" shows the uploaded image.
interface Props {
  model: string;
  body: string; accent: string; canopy: string;
  imageUrl?: string | null;
  /** Rendered width in px (height = width / 2). */
  width?: number;
  className?: string;
  title?: string;
}

export default function PlaneMark({ model, body, accent, canopy, imageUrl, width = 40, className = '', title }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svg = useMemo(() => (PLANE_MAP[model] ? planeSvg(model, { body, accent, canopy }, { idSuffix: uid, size: width }) : ''), [model, body, accent, canopy, uid, width]);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  if (model === 'custom' && imageUrl) {
    return <img src={imageUrl} alt={title ?? ''} {...(title ? {} : { 'aria-hidden': true })} className={`object-contain ${className}`} style={{ width, height: width / 2 }} />;
  }
  if (!svg) {
    return <img src="/plane.png" alt={title ?? ''} {...(title ? {} : { 'aria-hidden': true })} className={`object-contain ${className}`} style={{ width, height: width / 2.38 }} />;
  }
  return <span {...a11y} className={`inline-block shrink-0 ${className}`} style={{ width, height: width / 2, lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
