import { z } from 'zod';
import { defineTool, ToolError } from './registry';
let nextRequest = 0;
async function ncbi(path: string, params: Record<string, string>) {
  const wait = Math.max(0, nextRequest - Date.now());
  nextRequest = Date.now() + wait + 400;
  if (wait > 10000)
    throw new ToolError('busy', 'Reference search is busy. Try again shortly.', 429);
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  try {
    const response = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${path}?${new URLSearchParams(params)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new Error('unavailable');
    return await response.json();
  } catch {
    throw new ToolError(
      'reference_unavailable',
      'PubMed is unavailable. Try again or use the PubMed website.',
      503,
    );
  }
}
export const searchMedicalReferences = defineTool({
  name: 'search_medical_references',
  module: 'core',
  description: 'Retrieve publication metadata and original links from PubMed; no clinical advice.',
  allow: ['staff:doctor'],
  input: z.object({
    topic: z
      .string()
      .trim()
      .min(3)
      .max(150)
      .refine(
        (v) => !/@|\d{7}|\n/.test(v),
        'Use a general medical topic without patient identifiers',
      ),
    consent: z.literal(true),
    guidelinesOnly: z.boolean().default(false),
  }),
  auditInput: () => ({ externalSearch: true }),
  auditOutput: (o: any) => ({ results: o.results.length }),
  async run(_r, i) {
    const term =
      i.topic +
      (i.guidelinesOnly
        ? ' AND (guideline[Publication Type] OR practice guideline[Publication Type])'
        : '');
    const search = await ncbi('esearch.fcgi', {
      db: 'pubmed',
      term,
      retmode: 'json',
      retmax: '8',
      sort: 'pub_date',
    });
    const ids = search.esearchresult?.idlist;
    if (!Array.isArray(ids))
      throw new ToolError('reference_invalid', 'Could not read PubMed results', 502);
    if (!ids.length) return { results: [], retrievedAt: new Date().toISOString() };
    const summary = await ncbi('esummary.fcgi', {
      db: 'pubmed',
      id: ids.filter((id: any) => /^\d+$/.test(id)).join(','),
      retmode: 'json',
    });
    return {
      results: ids.flatMap((id: string) => {
        const s = summary.result?.[id];
        return s?.title
          ? [
              {
                id,
                title: s.title,
                date: s.pubdate,
                journal: s.fulljournalname,
                types: s.pubtype ?? [],
                url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
              },
            ]
          : [];
      }),
      retrievedAt: new Date().toISOString(),
    };
  },
});
