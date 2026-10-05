import { afterEach, expect, it, vi } from 'vitest';
import { searchMedicalReferences } from '../src/tools/reference-search';
afterEach(() => vi.unstubAllGlobals());
it('requires explicit consent and rejects obvious identifiers before any network request', () => {
  expect(() => searchMedicalReferences.input.parse({ topic: 'diabetes' })).toThrow();
  expect(() =>
    searchMedicalReferences.input.parse({ topic: 'patient@example.com', consent: true }),
  ).toThrow();
  expect(() =>
    searchMedicalReferences.input.parse({ topic: '9876543210', consent: true }),
  ).toThrow();
});
it('retrieves source metadata, dates and links without inventing a clinical answer', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ esearchresult: { idlist: ['1234'] } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          1234: {
            title: 'Source title',
            pubdate: '2026 Sep',
            fulljournalname: 'Source journal',
            pubtype: ['Guideline'],
          },
        },
      }),
    });
  vi.stubGlobal('fetch', fetcher);
  const result = await searchMedicalReferences.run({} as any, {
    topic: 'general topic',
    consent: true,
    guidelinesOnly: true,
  });
  expect(result.results).toEqual([
    {
      id: '1234',
      title: 'Source title',
      date: '2026 Sep',
      journal: 'Source journal',
      types: ['Guideline'],
      url: 'https://pubmed.ncbi.nlm.nih.gov/1234/',
    },
  ]);
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.hostname).toBe('eutils.ncbi.nlm.nih.gov');
  expect(url.searchParams.get('term')).toContain('guideline[Publication Type]');
  expect(result).not.toHaveProperty('answer');
});
it('returns an actionable failure when the external source is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await expect(
    searchMedicalReferences.run({} as any, {
      topic: 'general topic',
      consent: true,
      guidelinesOnly: false,
    }),
  ).rejects.toThrow('PubMed is unavailable');
});
