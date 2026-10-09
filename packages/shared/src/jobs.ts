/** Patient outreach can run independently from queue housekeeping and other clinic jobs. */
export function patientMessageJobsEnabled(env: {
  PATIENT_MESSAGES_JOBS_ENABLED?: string;
  JOBS_ENABLED?: string;
}): boolean {
  return (env.PATIENT_MESSAGES_JOBS_ENABLED ?? env.JOBS_ENABLED) !== 'false';
}
