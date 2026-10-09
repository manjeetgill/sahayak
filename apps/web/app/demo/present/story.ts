export type Beat = {
  title: string;
  phase: number;
  who: string;
  why: string;
  action: string;
  text?: string;
};
export const beats: Beat[] = [
  {
    title: 'A patient says hello',
    phase: 0,
    who: 'Booking assistant',
    why: 'A patient can start with a simple message, without calling reception.',
    action: 'chat',
    text: 'Hello',
  },
  {
    title: 'The patient asks for an appointment',
    phase: 0,
    who: 'Booking assistant',
    why: 'The assistant guides the patient through the booking.',
    action: 'chat',
    text: '1',
  },
  {
    title: 'A first visit',
    phase: 0,
    who: 'Booking assistant',
    why: 'The clinic learns whether this is a first visit or a follow-up.',
    action: 'chat',
    text: '1',
  },
  {
    title: 'Find a suitable time',
    phase: 0,
    who: 'Booking assistant',
    why: 'Available times come from the clinic’s actual appointment calendar.',
    action: 'chat',
    text: 'earliest',
  },
  {
    title: 'The patient chooses a slot',
    phase: 0,
    who: 'Booking assistant',
    why: 'The patient chooses a time before the booking is confirmed.',
    action: 'chat',
    text: '1',
  },
  {
    title: 'Appointment confirmed',
    phase: 0,
    who: 'Booking assistant',
    why: 'The confirmed appointment appears in the clinic. It is not yet a queue entry.',
    action: 'chat',
    text: 'yes',
  },
  {
    title: 'Permission for reminders',
    phase: 0,
    who: 'Booking assistant',
    why: 'The patient chooses whether to receive appointment reminders.',
    action: 'chat',
    text: 'yes',
  },
  {
    title: 'The patient arrives and checks in',
    phase: 1,
    who: 'Arrival assistant',
    why: 'The QR form connects the arriving patient to the same patient record.',
    action: 'arrive',
  },
  {
    title: 'Payment recorded → token issued',
    phase: 2,
    who: 'Clinic staff',
    why: 'Recording the practice cash payment adds the patient to the doctor’s queue.',
    action: 'payment',
  },
  {
    title: 'Use the waiting time well',
    phase: 3,
    who: 'Patient',
    why: 'The patient shares what they want to discuss. The doctor sees it before the visit.',
    action: 'waiting',
  },
  {
    title: 'The doctor calls the patient in',
    phase: 4,
    who: 'Doctor',
    why: 'The queue moves to “With the doctor”, and the pre-visit brief is ready.',
    action: 'call',
  },
  {
    title: 'A draft note is ready',
    phase: 4,
    who: 'Doctor workspace',
    why: 'This rehearsal saves the supplied practice text as a structured draft. The doctor remains responsible for the note.',
    action: 'note',
  },
  {
    title: 'Doctor reviews and approves',
    phase: 4,
    who: 'Doctor approval required',
    why: 'The demo pauses here. Review the note and instructions before signing.',
    action: 'review',
  },
  {
    title: 'Visit complete → feedback scheduled',
    phase: 5,
    who: 'Follow-up workflow',
    why: 'Finishing the visit schedules feedback using the doctor’s saved preference.',
    action: 'finish',
  },
  {
    title: 'At home: an invitation to give feedback',
    phase: 6,
    who: 'Feedback assistant · preview',
    why: 'This is a preview of the invitation. The private form works now; live WhatsApp delivery needs an approved template.',
    action: 'invite',
  },
  {
    title: 'The patient asks for clarification',
    phase: 6,
    who: 'Patient',
    why: 'A fictional response is submitted through the real feedback form service and saved against this visit.',
    action: 'response',
  },
  {
    title: 'The doctor gets a follow-up task',
    phase: 7,
    who: 'Doctor’s work list',
    why: 'The concern is assigned to the doctor. A person follows up; the demo does not claim the concern is resolved.',
    action: 'handoff',
  },
];
export const phases = [
  'Message & booking',
  'QR arrival',
  'Payment & queue',
  'While waiting',
  'Consultation',
  'Visit finished',
  'Patient feedback',
  'Doctor follow-up',
];
export const noteText =
  'DEMO: Patient attended for a clinic workflow demonstration and asked for clarification of the next steps. No examination findings, diagnosis or medicines were recorded.';
export const waitingAnswer = 'DEMO: I would like to understand what happens after my visit.';
export const suggestion = 'DEMO: Please explain the next steps more clearly.';
