import { parentPort, workerData } from 'node:worker_threads';
try {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(workerData),
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  if (pdf.numPages > 30) throw new Error('too_many_pages');
  const pages = [];
  let size = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n),
      content = await page.getTextContent();
    const text = content.items
      .map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : ''))
      .join('');
    size += text.length;
    if (size > 200000) throw new Error('too_long');
    pages.push({ page: n, text });
  }
  await task.destroy();
  parentPort.postMessage({ pages });
} catch {
  parentPort.postMessage({
    error:
      'Could not extract this PDF. It may be scanned, protected, damaged or over the 30-page/text limit. Enter verified results manually.',
  });
}
