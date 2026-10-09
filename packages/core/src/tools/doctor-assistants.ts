import { z } from 'zod';
import type { Db } from '@sahayak/db';
import { defineTool, ToolError, type ToolContext } from './registry';
const kind = z.enum(['whatsapp', 'phone', 'reminders']);
export type AssistantKind = z.infer<typeof kind>;

/** No row preserves the existing clinic service. Personal management requires an explicit grant. */
export async function doctorAssistantEnabled(
  db: Db,
  doctorId: string | null | undefined,
  channel: AssistantKind,
) {
  if (!doctorId) return true;
  const d = (await db.query('SELECT id FROM doctors WHERE id=$1 AND active', [doctorId])).rows[0];
  if (!d) return false;
  const row = (
    await db.query(
      'SELECT allowed,enabled FROM doctor_assistant_access WHERE doctor_id=$1 AND kind=$2 FOR SHARE',
      [doctorId, channel],
    )
  ).rows[0];
  return !row || (row.allowed && row.enabled);
}
export async function assistantOwner(
  db: Db,
  ctx: ToolContext,
  requireEnabled = false,
): Promise<string | null> {
  if (ctx.actor.kind === 'staff' && (ctx.actor.role === 'admin' || ctx.actor.clinicAdmin))
    return null;
  if (ctx.actor.kind !== 'staff' || ctx.actor.role !== 'doctor' || !ctx.actor.doctorId)
    throw new ToolError('forbidden', 'Only an authorised doctor can manage their assistants.', 403);
  const id = ctx.actor.doctorId;
  const access = (
    await db.query(
      `SELECT a.allowed,a.enabled FROM doctor_assistant_access a JOIN doctors d ON d.id=a.doctor_id
    WHERE a.doctor_id=$1 AND a.kind='reminders' AND d.active FOR SHARE OF a`,
      [id],
    )
  ).rows[0];
  if (!access?.allowed || (requireEnabled && !access.enabled))
    throw new ToolError(
      'assistant_access',
      'Your admin must allow reminders, and you must enable them before activation.',
      403,
    );
  return id;
}
export async function ownedAgent(db: Db, ctx: ToolContext, id: string, requireEnabled = false) {
  // Preserve reception's existing emergency pause for clinic-wide tasks only.
  if (ctx.actor.kind === 'staff' && ctx.actor.role === 'receptionist') {
    const a = (
      await db.query('SELECT * FROM custom_agents WHERE id=$1 AND doctor_id IS NULL FOR UPDATE', [
        id,
      ])
    ).rows[0];
    if (!a) throw new ToolError('not_found', 'Assistant not found', 404);
    return a;
  }
  const owner = await assistantOwner(db, ctx, requireEnabled);
  const a = (
    await db.query(
      'SELECT * FROM custom_agents WHERE id=$1 AND ($2::uuid IS NULL OR doctor_id=$2) FOR UPDATE',
      [id, owner],
    )
  ).rows[0];
  if (!a) throw new ToolError('not_found', 'Assistant not found', 404);
  return a;
}
const accessList = defineTool({
  name: 'list_doctor_assistant_access',
  module: 'core',
  description: 'Doctor assistant permissions and preferences.',
  scope: 'read',
  input: z.object({}),
  allow: ['staff:admin', 'staff:doctor'],
  async run({ db, ctx }) {
    const actor = ctx.actor;
    if (actor.kind !== 'staff') throw new ToolError('forbidden', 'Staff only', 403);
    if (actor.role === 'doctor' && !actor.doctorId)
      throw new ToolError('forbidden', 'Your account needs a doctor profile.', 403);
    const doctors = (
      await db.query(
        'SELECT id,name FROM doctors WHERE active AND ($1::uuid IS NULL OR id=$1) ORDER BY name',
        [actor.role === 'doctor' ? actor.doctorId : null],
      )
    ).rows;
    const access = (
      await db.query(
        'SELECT doctor_id,kind,allowed,enabled FROM doctor_assistant_access WHERE ($1::uuid IS NULL OR doctor_id=$1)',
        [actor.role === 'doctor' ? actor.doctorId : null],
      )
    ).rows;
    return {
      doctors: doctors.map((d) => ({
        ...d,
        assistants: ['whatsapp', 'phone', 'reminders'].map((k) => {
          const a = access.find((a) => a.doctor_id === d.id && a.kind === k);
          return {
            kind: k,
            allowed: a?.allowed ?? false,
            enabled: a?.enabled ?? false,
            clinicManaged: !a,
          };
        }),
      })),
    };
  },
});
const grant = defineTool({
  name: 'set_doctor_assistant_access',
  module: 'core',
  description: 'Admin grants or revokes an assistant for one doctor.',
  input: z.object({ doctorId: z.string().uuid(), kind, allowed: z.boolean() }),
  allow: ['staff:admin'],
  async run({ db, ctx }, i) {
    if (!(await db.query('SELECT id FROM doctors WHERE id=$1 AND active', [i.doctorId])).rowCount)
      throw new ToolError('not_found', 'Doctor not found', 404);
    await db.query(
      `INSERT INTO doctor_assistant_access(clinic_id,doctor_id,kind,allowed) VALUES($1,$2,$3,$4)
      ON CONFLICT(clinic_id,doctor_id,kind) DO UPDATE SET allowed=$4,enabled=CASE WHEN $4 THEN doctor_assistant_access.enabled ELSE false END,updated_at=now()`,
      [ctx.clinicId, i.doctorId, i.kind, i.allowed],
    );
    if (!i.allowed && i.kind === 'reminders') await pauseOwned(db, i.doctorId);
    return { ok: true };
  },
});
async function pauseOwned(db: Db, id: string) {
  await db.query(
    "UPDATE custom_agents SET status='paused',next_run_at=NULL,updated_at=now() WHERE doctor_id=$1 AND status='active'",
    [id],
  );
  await db.query(
    `UPDATE agent_runs SET status='skipped', result='{"reason":"doctor reminders paused"}' WHERE status='pending' AND agent_id IN(SELECT id FROM custom_agents WHERE doctor_id=$1)`,
    [id],
  );
}
const preference = defineTool({
  name: 'set_my_assistant_preference',
  module: 'core',
  description: 'Doctor enables or pauses their own assistant.',
  input: z.object({ kind, enabled: z.boolean() }),
  allow: ['staff:doctor'],
  async run({ db, ctx }, i) {
    const id = ctx.actor.kind === 'staff' ? ctx.actor.doctorId : null;
    if (!id) throw new ToolError('forbidden', 'Your account needs a doctor profile.', 403);
    if (ctx.actor.kind === 'staff' && ctx.actor.clinicAdmin) {
      const saved = await db.query(
        `INSERT INTO doctor_assistant_access(clinic_id,doctor_id,kind,allowed,enabled)
         SELECT $1,$2,$3,true,$4 WHERE EXISTS(SELECT 1 FROM doctors WHERE id=$2 AND active)
         ON CONFLICT(clinic_id,doctor_id,kind) DO UPDATE
         SET allowed=true,enabled=$4,updated_at=now() RETURNING doctor_id`,
        [ctx.clinicId, id, i.kind, i.enabled],
      );
      if (!saved.rowCount) throw new ToolError('doctor_required', 'Your doctor profile is inactive', 403);
      if (!i.enabled && i.kind === 'reminders') await pauseOwned(db, id);
      return { ok: true };
    }
    const saved = await db.query(
      `UPDATE doctor_assistant_access SET enabled=$2,updated_at=now() WHERE doctor_id=$1 AND kind=$3 AND allowed
      AND EXISTS(SELECT 1 FROM doctors WHERE id=$1 AND active) RETURNING doctor_id`,
      [id, i.enabled, i.kind],
    );
    if (!saved.rowCount)
      throw new ToolError('assistant_access', 'Your admin has not allowed this assistant.', 403);
    if (!i.enabled && i.kind === 'reminders') await pauseOwned(db, id);
    return { ok: true };
  },
});
export const doctorAssistantTools = [accessList, grant, preference];
