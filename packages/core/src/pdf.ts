import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { t, type Lang } from '@sahayak/shared';

const req = createRequire(import.meta.url);
const fontDir = (pkg: string) => dirname(req.resolve(`${pkg}/package.json`));
const FONTS = {
  latin: join(fontDir('@expo-google-fonts/noto-sans'), 'NotoSans_400Regular.ttf'),
  latinBold: join(fontDir('@expo-google-fonts/noto-sans'), 'NotoSans_700Bold.ttf'),
  deva: join(
    fontDir('@expo-google-fonts/noto-sans-devanagari'),
    'NotoSansDevanagari_400Regular.ttf',
  ),
  devaBold: join(
    fontDir('@expo-google-fonts/noto-sans-devanagari'),
    'NotoSansDevanagari_700Bold.ttf',
  ),
};

export interface PdfInput {
  clinic: { name: string; address: string | null; phone: string | null };
  doctor: { name: string; qualifications: string | null; registrationNo: string };
  patient: { name: string; age: number | null };
  doc: {
    kind: 'certificate' | 'prescription';
    subtype: 'sick_leave' | 'fitness' | 'attendance' | 'prescription';
    content: Record<string, any>;
    language: 'en' | 'hi' | 'both';
    number: string;
    signedAt: Date;
    verifyCode: string;
    voided?: boolean;
  };
  verifyUrl: string;
}

const fmtDate = (d: Date | string, lang: Lang) =>
  new Date(d).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/** The text of the certificate body in one language. Fixed templates: the doctor's choices fill the blanks, nothing is composed. */
export function certificateText(lang: Lang, i: PdfInput): string[] {
  const c = i.doc.content;
  const age = i.patient.age ? t(lang, 'doc.age', { n: i.patient.age }) : '';
  const vars = { name: i.patient.name, age, date: fmtDate(c.examined_on ?? i.doc.signedAt, lang) };
  const out: string[] = [];
  if (i.doc.subtype === 'sick_leave') {
    out.push(
      t(lang, 'doc.cert.sick_leave', {
        ...vars,
        days: c.days,
        from: fmtDate(c.from_date, lang),
        to: fmtDate(c.to_date, lang),
      }),
    );
    if (c.include_diagnosis && c.diagnosis)
      out.push(t(lang, 'doc.cert.diagnosis', { diagnosis: c.diagnosis }));
  } else if (i.doc.subtype === 'fitness') {
    out.push(
      t(lang, 'doc.cert.fitness', { ...vars, purpose: c.purpose ? String(c.purpose) : '' }).replace(
        /\s+\./,
        '.',
      ),
    );
  } else {
    out.push(t(lang, 'doc.cert.attendance', vars));
  }
  if (c.remarks) out.push(t(lang, 'doc.cert.remarks', { remarks: c.remarks }));
  return out;
}

/** A4 PDF: letterhead, body, doctor's registration, document number, QR code for verification. English, Hindi or both. */
export async function renderDocumentPdf(i: PdfInput): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: { Title: `${i.doc.number}`, Author: i.doctor.name },
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => pdf.on('end', () => res(Buffer.concat(chunks))));
  pdf
    .registerFont('Latin', FONTS.latin)
    .registerFont('LatinBold', FONTS.latinBold)
    .registerFont('Deva', FONTS.deva)
    .registerFont('DevaBold', FONTS.devaBold);
  const fnt = (lang: Lang, bold = false) =>
    lang === 'hi' ? (bold ? 'DevaBold' : 'Deva') : bold ? 'LatinBold' : 'Latin';
  const langs: Lang[] = i.doc.language === 'both' ? ['en', 'hi'] : [i.doc.language];
  const W = pdf.page.width - 100;

  // Letterhead
  pdf.font('LatinBold').fontSize(20).fillColor('#0f766e').text(i.clinic.name, { align: 'center' });
  pdf
    .font('Latin')
    .fontSize(9)
    .fillColor('#444')
    .text([i.clinic.address, i.clinic.phone].filter(Boolean).join('  ·  '), { align: 'center' });
  pdf
    .moveDown(0.3)
    .strokeColor('#0f766e')
    .lineWidth(1.2)
    .moveTo(50, pdf.y)
    .lineTo(50 + W, pdf.y)
    .stroke()
    .moveDown(0.6);
  pdf.font('LatinBold').fontSize(11).fillColor('#111').text(i.doctor.name, { continued: false });
  pdf
    .font('Latin')
    .fontSize(9)
    .fillColor('#444')
    .text(
      [i.doctor.qualifications, `Reg. No. ${i.doctor.registrationNo}`]
        .filter(Boolean)
        .join('  ·  '),
    );
  pdf.moveDown(0.8);

  for (const lang of langs) {
    pdf
      .fillColor('#111')
      .font(fnt(lang, true))
      .fontSize(14)
      .text(t(lang, `doc.title.${i.doc.subtype}` as any), { align: 'center' });
    pdf.moveDown(0.5);
    pdf
      .font(fnt(lang))
      .fontSize(10)
      .fillColor('#333')
      .text(`${t(lang, 'doc.date')}: ${fmtDate(i.doc.signedAt, lang)}`, { align: 'right' });
    pdf.text(
      `${t(lang, 'doc.patient')}: ${i.patient.name}${i.patient.age ? `  (${t(lang, 'doc.age', { n: i.patient.age })})` : ''}`,
    );
    pdf.moveDown(0.6);
    if (i.doc.kind === 'certificate') {
      for (const para of certificateText(lang, i))
        pdf
          .font(fnt(lang))
          .fontSize(11.5)
          .fillColor('#111')
          .text(para, { align: 'justify', lineGap: 4 })
          .moveDown(0.5);
    } else {
      const c = i.doc.content;
      const items: any[] = c.items ?? [];
      items.forEach((it, n) => {
        const head = [it.form, it.drug, it.strength].filter(Boolean).join(' ');
        pdf
          .font('LatinBold')
          .fontSize(11.5)
          .fillColor('#111')
          .text(`${n + 1}. ${head}`);
        const detail = [
          it.dose && `${t(lang, 'doc.rx.dose')}: ${it.dose}`,
          it.frequency && `${t(lang, 'doc.rx.frequency')}: ${it.frequency}`,
          it.duration && `${t(lang, 'doc.rx.duration')}: ${it.duration}`,
          it.instructions && `${t(lang, 'doc.rx.instructions')}: ${it.instructions}`,
        ]
          .filter(Boolean)
          .join('   ·   ');
        pdf
          .font(fnt(lang))
          .fontSize(10)
          .fillColor('#444')
          .text(detail, { indent: 16 })
          .moveDown(0.3);
      });
      if (c.allergies_noted)
        pdf
          .font(fnt(lang))
          .fontSize(10)
          .fillColor('#b91c1c')
          .text(`${t(lang, 'doc.rx.allergies')}: ${c.allergies_noted}`)
          .moveDown(0.3);
      if (c.advice)
        pdf
          .font(fnt(lang, true))
          .fontSize(10.5)
          .fillColor('#111')
          .text(`${t(lang, 'doc.rx.advice')}: `, { continued: true })
          .font(fnt(lang))
          .text(c.advice)
          .moveDown(0.3);
      if (c.follow_up)
        pdf
          .font(fnt(lang, true))
          .fontSize(10.5)
          .fillColor('#111')
          .text(`${t(lang, 'doc.rx.follow_up')}: `, { continued: true })
          .font(fnt(lang))
          .text(c.follow_up);
    }
    if (langs.length > 1 && lang === 'en')
      pdf
        .moveDown(1)
        .strokeColor('#ddd')
        .lineWidth(0.5)
        .moveTo(50, pdf.y)
        .lineTo(50 + W, pdf.y)
        .stroke()
        .moveDown(1);
  }

  // Signature block, number, verification QR
  const qr = await QRCode.toBuffer(i.verifyUrl, { margin: 1, width: 180 });
  pdf.moveDown(1.5);
  const y = Math.max(pdf.y, 640);
  const sigLang = langs[0];
  pdf
    .font(fnt(sigLang, true))
    .fontSize(10)
    .fillColor('#111')
    .text(i.doctor.name, 50, y, { width: W - 120 });
  pdf
    .font(fnt(sigLang))
    .fontSize(9)
    .fillColor('#444')
    .text(
      t(sigLang, 'doc.signed_by', {
        doctor: i.doctor.name,
        reg: i.doctor.registrationNo,
        date: fmtDate(i.doc.signedAt, sigLang),
      }),
      50,
      pdf.y,
      { width: W - 120 },
    );
  pdf.image(qr, 50 + W - 90, y - 4, { width: 90 });
  pdf
    .font(fnt(sigLang))
    .fontSize(8)
    .fillColor('#666')
    .text(t(sigLang, 'doc.footer', { number: i.doc.number, url: i.verifyUrl }), 50, y + 92, {
      width: W,
    });
  pdf.text(t(sigLang, 'doc.disclaimer'), { width: W });
  if (i.doc.voided)
    pdf
      .font('LatinBold')
      .fontSize(60)
      .fillColor('#dc2626')
      .opacity(0.25)
      .rotate(-30, { origin: [300, 400] })
      .text('VOID', 180, 360)
      .rotate(30, { origin: [300, 400] })
      .opacity(1);
  pdf.end();
  return done;
}
