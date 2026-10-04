import { validateSpec, explainSpec } from '@sahayak/core';
import type { LlmGate } from '../llm';

const SYSTEM = `You convert a doctor's plain-language request into a JSON automation spec. Reply ONLY with JSON.
Shape: {"name": string, "spec": {"trigger": T, "audience": A, "action": X}}
T is one of: {"type":"schedule","every":"day","at":"HH:MM"} | {"type":"schedule","every":"week","weekday":0-6,"at":"HH:MM"} | {"type":"schedule","every":"month","dayOfMonth":1-28,"at":"HH:MM"} | {"type":"event","event":"visit.finished"|"appointment.booked"|"appointment.cancelled"|"patient.checked_in","delayHours":0-168}
A (all optional): {"tags":["label"],"lastVisitOlderThanDays":n,"lastVisitWithinDays":n,"hasUpcomingAppointment":true|false}
X is one of: {"type":"message_patients","text":{"en":"...","hi":"... (optional)"}} | {"type":"notify_staff","to":"doctor"|"receptionist"|"both","text":{"en":"..."}} | {"type":"summary","metrics":["seen","no_shows","appointments","cancellations","new_patients","wait","consult","busiest","upcoming","flags","messages","ratings"]}
Rules: messages may use only {name} and {clinic}. No links. No medical advice, doses, diagnoses or reassurance: only reminders and clinic information. Scheduled patient messages need an audience filter and a time between 08:00 and 20:59. If the request cannot be done with these blocks, reply {"error":"..."}.`;

/** Optional second opinion for requests the built-in patterns did not understand. Its output must still pass the same validation. */
export async function llmInterpret(gate: LlmGate | null, text: string) {
  if (!gate?.available()) return null;
  try {
    const r = await gate.chat({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
      temperature: 0,
      maxTokens: 700,
    });
    const j = JSON.parse((r.content ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    if (j.error || !j.spec) return null;
    const v = validateSpec(j.spec);
    return {
      understood: true,
      name: String(j.name ?? 'New agent').slice(0, 80),
      spec: v.ok ? v.spec : j.spec,
      problems: v.ok ? [] : v.problems,
      explain: v.ok ? explainSpec(v.spec) : [],
      notes: ['Proposed by the AI assistant. Please read the explanation carefully.'],
    };
  } catch {
    return null;
  }
}
