import type { Lang } from '@sahayak/shared';

/** Adapter for a patient messaging channel (WhatsApp Business later). */
export interface MessagingChannel {
  readonly name: string;
  send(msg: { clinicId: string; to: string; text: string; lang: Lang }): Promise<void>;
}

/** Adapter for phone calls (voice agent comes after the pilot). Declared so tools never depend on a vendor. */
export interface VoiceChannel {
  readonly name: string;
  startCall(args: { clinicId: string; to: string }): Promise<void>;
}

/**
 * Mock WhatsApp: the simulator page reads the `messages` table, so the stored row IS the delivery.
 * A real adapter would additionally call the vendor API here.
 */
export class MockWhatsAppChannel implements MessagingChannel {
  readonly name = 'mock-whatsapp';
  async send(): Promise<void> {
    /* stored message row is the delivery */
  }
}
