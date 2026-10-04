/** Last line of defence on anything an LLM drafted: no diagnoses, doses or reassurance about symptoms. */
const BAD_OUTPUT = [
  /\b\d+(\.\d+)?\s?(mg|mcg|ml|iu)\b/i,
  /\b(take|taking|try|use|have)\b[^.]{0,30}\b(paracetamol|crocin|dolo|ibuprofen|antibiotic|tablet|capsule|syrup|medicine|ointment)\b/i,
  /\byou (probably |likely |may |might )?have\b/i,
  /\b(it'?s|it is|this is) (just |probably |likely )?(a |an )?(viral|infection|flu|nothing|not serious|normal)\b/i,
  /\bdon'?t worry\b/i,
  /\bno need to worry\b/i,
  /चिंता न करें|चिंता मत करें|घबराएं नहीं|आपको .*(बुखार|संक्रमण) है/,
];
export function violatesMedicalPolicy(draft: string): boolean {
  return BAD_OUTPUT.some((r) => r.test(draft));
}
