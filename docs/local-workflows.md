# Local doctor workflows

## Start and update

Use the existing local Postgres instance and the root `.env`. Never paste its values into chat or logs. Apply migrations with environment variables loaded before starting the API. The web app remains on port 3000; the API normally runs on port 4000. The additions do not require AI-Agent-Platform or a real model key.

## Consultation to follow-up

1. Open a patient and read **Before the consultation**. Verified structured facts appear alongside original concerns, intake answers, visits, signed notes and uploaded records.
2. Dictate or type a note. New headings include Assessment, Differential, Investigations and Instructions. Review every section and sign. Unlabelled text remains in History; the tool does not invent missing clinical facts.
3. In **Ongoing care → Instructions to give the patient**, select the signed note. Review/edit its copied plan and approve. Approved text can be downloaded. Hindi changes headings, not the body language.
4. In **Plan the next steps**, select a responsible doctor, wording and date/time for every step. Save for review, then approve. Pause/resume or cancel as necessary. These are local tasks; approving does not send a message.
5. Due work appears in **Needs my attention**. Record contact made through the clinic's normal process, then the patient's reply or doctor's review. The tool retains reply history. Emergency keyword matches create an urgent alert; completion stays blocked until the alert is reviewed and resolved.
6. The completion checklist also reports unsigned notes, draft documents, instruction drafts, draft plans and unverified entries. Finishing a visit is still an explicit staff decision after review.

Reusable plans live at `/doctor/templates`. A clinic version contains generic wording and relative days, with no patient information. Approval freezes that version. Applying it creates a separate patient draft, uses a request ID to prevent duplicates, and still requires patient-specific date/wording review followed by plan approval. Contact starts a 48-hour reply deadline. An overdue reply can be recorded as **No reply recorded**, returns to the inbox, and can be contacted again.

## Source-linked history and results

- Record medicine ingredients, dose and frequency exactly as documented. Verify only after checking the source. Existing entries can be marked stopped/completed/incorrect while remaining visible in history.
- Record allergies explicitly. An empty list never means “no known allergies.”
- Numeric test results require an uploaded source report. Table import supports up to 100 rows: name, numeric result, unit, optional lower/upper interval and sample/method, separated by tabs. Import creates unverified records. Qualitative values, inequality values and ranges are rejected rather than guessed.
- Results over time compare only equal test names, units and sample/method text. Same-name tests can still differ clinically; the doctor must judge comparability. Missing sample/method is not proof of equivalence.
- Source text and report links stay accessible. There is no OCR, image/ECG interpretation or generated diagnosis in this release.
- The record browser supports a bounded set of source-excerpt questions and blank-query paging. It does not generate clinical explanations. Selectable PDF text can be extracted locally, page by page, beside the original. Extraction is unverified, limited to 10 MB, 30 pages and 200,000 characters, and scanned/image-only reports still need manual entry or future OCR.
- Medicine record warnings only check exact ingredient duplicates and exact allergy-name matches. Prescription drafts also compare each entered medicine name with verified allergy substances and active medicine ingredients, and flag duplicate prescription lines. These exact-text prompts are not a prescription safety certification and do not cover interactions, doses, classes, brands, age, pregnancy or organ function.

Verified values outside the source report's supplied range appear in the inbox until a doctor records a review note. This is workflow tracking. It does not label a patient clinically abnormal, and within-range values do not establish normality.

## Inbox

Assign an inbox owner, acknowledge an item, or defer nonurgent work until tomorrow. **Remind me later** restores it early; it returns automatically when the deferral expires. Urgent work cannot be deferred and its count remains visible in every view. Source tasks, notes, instructions and reports must be completed in their original record. Only alerts and staff conversations can be marked handled with a reason. New messages reopen handled conversation work. Acknowledgement does not imply clinical resolution.

## References

PubMed search retrieves publication metadata, publication types and original links; it does not answer a clinical question. Only a general topic is sent to NCBI after the doctor's checkbox confirmation. Obvious email/long numeric identifiers are rejected, but this is not a complete patient-data detector. The clinic reading list stores doctor-reviewed titles, source links, dates and notes. Review again dates flag stale reviews; references may be edited or removed from the active list.

Official API reference: https://www.ncbi.nlm.nih.gov/books/NBK25499/

## Translation drafts

After instructions are approved, a doctor can explicitly send that approved text to the configured clinic AI service for a translation draft. Supported choices are English, Hindi, Hinglish, Marathi, Bengali, Tamil, Telugu, Kannada and Gujarati. The original approved wording is preserved beside the result. A numeric-token check rejects changed numbers; it cannot prove clinical meaning. The result stays a draft and needs another doctor review and approval. The app does not add advice or warnings.

## Insurance paperwork

Local cases track an owner, due date, optional source document and actual correspondence through Preparing → Submitted → More information / Approved / Denied → Closed. The app does not submit to an insurer or decide coverage. Open cases appear in the inbox; overdue cases are prioritised.

## Charges and payments

Record a charge and money already received. Partial payments are supported. Repeating the same payment request cannot double-count it, and overpayment is rejected. Mistaken payments can be corrected while preserving history; enter the actual payment separately. Cancelling a charge requires it to have no uncorrected payments. These controls do not collect, transfer or refund money. Patient erasure removes the link and description from retained financial records.

## Clinic measures

The clinic overview reports no-show, referral and due-follow-up completion with numerator and denominator. Consultation duration uses the explicit moment a called patient enters consultation and the recorded finish; older call timestamps are not backfilled. Collections per paying patient use identifiable patients with a non-corrected payment in the selected period. These describe recorded workflow and money entries, not clinical outcomes, bank reconciliation or ROI.

## Verification commands

- `pnpm typecheck`
- `pnpm lint` (generated `.next-e2e` output is excluded)
- `pnpm test` uses synthetic clinic fixtures and cleans them up; requires local test database access.
- `pnpm e2e` creates separate temporary API/web servers and a disposable database; it never resets the normal demo clinic. Live providers and real AI calls are disabled.

New integration coverage checks doctor/clinic boundaries, source ownership, unverified import, exact medicine matching, approved instruction immutability, plan approval, urgent-response escalation, completion gates, inbox defer/restore/assignment, idempotent payments, overpayment, correction history, dated references, exports, audit redaction and erasure retention. PubMed success/failure is tested with mocked responses; a real general-topic smoke test also returned eight original source links on 5 October 2026.

New browser journeys verify structured history → verification → approved instructions → approved plan → contact → reviewed completion → recorded payment, reusable clinic plan → patient-specific draft → approval, result review, insurance correspondence, local source search, reading-list persistence, and inbox acknowledgement/assignment/resolution. These tests establish software behavior with synthetic records, not clinical validation or real-channel delivery readiness.

## Latest verification result — 5 October 2026

Workspace typechecking passed. ESLint completed with four existing unused-variable warnings and no errors. All 375 tests passed across 31 test files; one provider-dependent test was intentionally skipped. The full browser suite passed all 18 journeys against a disposable database. Existing browser flows use simulated channels. No real patient messages or calls were sent during verification.
