import { call, say, type Turn } from '../turn';

const AGENT = 'queue';

export async function queueStatus(turn: Turn) {
  if (!turn.patientId) return say(turn, AGENT, 'msg.not_in_queue');
  const s = await call(turn, AGENT, 'get_my_queue_status', { patientId: turn.patientId });
  if (!s.inQueue) return say(turn, AGENT, 'msg.not_in_queue');
  if (s.status === 'called' || s.status === 'in_consultation')
    return say(turn, AGENT, 'msg.queue_called', { token: s.token });
  return say(turn, AGENT, 'msg.queue_status', {
    token: s.token,
    ahead: s.patientsAhead,
    wait: s.waitMinutes,
  });
}

/** Patients cannot reorder the queue. Say so, and let a human know it was asked. */
export async function refuseReorder(turn: Turn) {
  await say(turn, AGENT, 'msg.queue_no_reorder');
  await call(turn, AGENT, 'flag_to_receptionist', {
    kind: 'other',
    summary: 'Patient asked to be moved ahead in the queue (declined by the queue agent).',
  });
}
