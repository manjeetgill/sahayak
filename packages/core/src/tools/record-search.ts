import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { defineTool, ToolError } from './registry';
const allow = ['staff:doctor'],
  UUID = z.string().uuid();
export const extractReport = defineTool({
  name: 'extract_report_text',
  module: 'core',
  description: 'Extract text locally from a stored PDF without interpreting it.',
  allow,
  input: z.object({ patientId: UUID, documentId: UUID }),
  auditOutput: () => ({ extracted: true }),
  async run(r, i) {
    const d = (
      await r.db.query('SELECT mime,data FROM patient_documents WHERE id=$1 AND patient_id=$2', [
        i.documentId,
        i.patientId,
      ])
    ).rows[0];
    if (!d) throw new ToolError('not_found', 'Patient report not found', 404);
    if (d.mime !== 'application/pdf' || d.data.length > 10 * 1024 * 1024)
      throw new ToolError('format', 'Choose a PDF up to 10 MB. Images require manual entry.');
    return await new Promise<any>((resolve, reject) => {
      const worker = new Worker(new URL('./pdf-text-worker.mjs', import.meta.url), {
        workerData: d.data,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          new ToolError('timeout', 'Report extraction timed out. Enter verified results manually.'),
        );
      }, 15000);
      worker.once('message', (result) => {
        clearTimeout(timer);
        void worker.terminate();
        if (result.error) reject(new ToolError('extract', result.error));
        else resolve({ ...result, documentId: i.documentId, verified: false });
      });
      worker.once('error', () => {
        clearTimeout(timer);
        reject(
          new ToolError('extract', 'Could not read this report. Enter verified results manually.'),
        );
      });
      worker.once('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(
            new ToolError('extract', 'Report extraction stopped. Enter verified results manually.'),
          );
      });
    });
  },
});
export const searchRecord = defineTool({
  name: 'search_patient_record',
  module: 'core',
  description:
    'Retrieve original patient-record excerpts, with supported fact filters; never infer a clinical answer.',
  allow,
  input: z.object({
    patientId: UUID,
    question: z.string().trim().max(200).default(''),
    page: z.number().int().min(0).default(0),
  }),
  auditInput: (i) => ({ patientId: i.patientId }),
  auditOutput: () => ({ searched: true }),
  async run(r, i) {
    if (!(await r.db.query('SELECT id FROM patients WHERE id=$1', [i.patientId])).rowCount)
      throw new ToolError('not_found', 'Patient not found', 404);
    const q = i.question.toLowerCase();
    const kind = /allerg/.test(q)
      ? 'allergy'
      : /medicin|medication|drug/.test(q)
        ? 'medication'
        : /\blab|\btest result/.test(q)
          ? 'lab'
          : null;
    const changed = kind === 'medication' && /chang|stop|why/.test(q);
    const outside = kind === 'lab' && /abnormal|outside/.test(q);
    const query = q
      .replace(
        /\b(show|me|all|what|why|was|were|is|are|the|this|patient|recorded|record|history|when|did|happen|after|before|medicine|medicines|medication|medications|drugs?|changed?|stopped?|allergies|allergy|labs?|test|results?|abnormal|outside|range|has|have|of|in|my)\b/g,
        ' ',
      )
      .trim();
    const result = await r.db.query(
      `WITH events AS (
 SELECT id,'entry'::text AS source,kind,occurred_on::timestamptz AS at,data::text AS body,verified_at IS NOT NULL AS verified,status,document_id,
 CASE WHEN kind='lab' THEN ((data->>'value')::numeric < (data->>'low')::numeric OR (data->>'value')::numeric > (data->>'high')::numeric) ELSE false END AS outside,
 CASE WHEN kind='medication' THEN COALESCE(data->>'reason','')<>'' OR status='stopped' ELSE false END AS changed
 FROM clinical_entries WHERE patient_id=$1
 UNION ALL SELECT id,'note','note',signed_at,note::text,true,status,NULL,false,false FROM visit_notes WHERE patient_id=$1 AND status='signed'
 UNION ALL SELECT id,'document','document',created_at,filename||' '||COALESCE(caption,''),false,status,id,false,false FROM patient_documents WHERE patient_id=$1
 UNION ALL SELECT id,'visit','visit',checked_in_at,'Visit '||status,true,status,NULL,false,false FROM queue_entries WHERE patient_id=$1
 ), matched AS (SELECT * FROM events WHERE ($2::text IS NULL OR kind=$2) AND (NOT $3 OR changed) AND (NOT $4 OR outside AND verified AND status='active') AND ($5='' OR to_tsvector('simple',body) @@ plainto_tsquery('simple',$5)))
 SELECT (SELECT count(*)::int FROM matched) AS total,COALESCE((SELECT jsonb_agg(x) FROM (SELECT * FROM matched ORDER BY at DESC,source,id LIMIT 25 OFFSET $6)x),'[]'::jsonb) AS records`,
      [i.patientId, kind, changed, outside, query, i.page * 25],
    );
    return {
      ...result.rows[0],
      page: i.page,
      message:
        'Original recorded excerpts only. Missing records do not establish a normal finding or explain a clinical decision.',
    };
  },
});
