import { useParams, Navigate } from 'react-router-dom';
import NavPage from '../ui/NavPage';
import { useBrand } from '../../brand/useBrand';

// The brand's own Terms / Privacy / Responsible gaming text (legal.* settings). Plain text with
// light structure: blank lines split paragraphs, lines starting with "#" are headings. Rendered as
// text nodes only — never as HTML.
const DOCS = {
  terms: { key: 'legal.terms', title: 'Terms' },
  privacy: { key: 'legal.privacy', title: 'Privacy' },
  responsible: { key: 'legal.responsible', title: 'Responsible gaming' },
} as const;

export default function LegalPage() {
  const { doc } = useParams();
  const brand = useBrand();
  const d = DOCS[doc as keyof typeof DOCS];
  const text = d ? (brand.config[d.key] as string | null) : null;
  if (!d || !text) return <Navigate to="/" replace />;
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <NavPage title={d.title}>
      <article className="space-y-3 px-5 pt-4 text-callout leading-relaxed text-ios-label2" data-testid={`legal-${doc}`}>
        {blocks.map((b, i) => b.startsWith('#')
          ? <h2 key={i} className="pt-2 text-headline text-white">{b.replace(/^#+\s*/, '')}</h2>
          : <p key={i} className="whitespace-pre-line">{b}</p>)}
        <p className="pt-4 text-footnote text-ios-label3">{[brand.config['legal.company'], brand.licence_line].filter(Boolean).join(' · ')}</p>
      </article>
    </NavPage>
  );
}
