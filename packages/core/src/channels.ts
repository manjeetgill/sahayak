import type { Lang } from '@sahayak/shared';

/** Adapter for outbound patient messaging (WhatsApp Business). */
export interface MessagingChannel {
  readonly name: string;
  /** true = delivered through the outbox job with retries (real vendors). false = instant (mock). */
  readonly queued: boolean;
  send(msg: { clinicId: string; to: string; text: string; lang: Lang }): Promise<void>;
}

/** One inbound patient message after the vendor's payload has been parsed. */
export interface InboundMessage {
  /** The clinic's WhatsApp business number the patient wrote to (E.164). */
  businessNumber: string;
  from: string;
  text: string;
}

/**
 * Vendor-specific inbound side: verify the webhook really came from the vendor, and turn its payload into
 * plain messages. A vendor integration = one MessagingChannel + one InboundAdapter + one entry in `channelRegistry`.
 */
export interface InboundAdapter {
  readonly name: string;
  /** Webhook verification handshake (GET), if the vendor has one. Return the response body or null to reject. */
  handshake?(query: Record<string, string>): string | null;
  /** Check the signature header against the raw body. Must be constant-time and fail closed. */
  verify(headers: Record<string, string | undefined>, rawBody: string): boolean;
  parse(body: unknown): InboundMessage[];
}

export interface ChannelPlugin {
  messaging: MessagingChannel;
  inbound: InboundAdapter;
}
export const channelRegistry = new Map<string, ChannelPlugin>();

/** Adapter for phone calls. Telephony vendors implement call control; speech goes through SpeechToText/TextToSpeech. */
export interface VoiceChannel {
  readonly name: string;
  startCall(args: { clinicId: string; to: string }): Promise<void>;
}

/** Speech adapters. Hindi and English must both be supported by any implementation we plug in. */
export interface SpeechToText {
  readonly name: string;
  transcribe(
    audio: Buffer,
    opts: { mimeType: string; languageHint?: Lang },
  ): Promise<{ text: string; language: Lang }>;
}
export interface TextToSpeech {
  readonly name: string;
  synthesize(text: string, lang: Lang): Promise<{ audio: Buffer; mimeType: string }>;
}

/**
 * Mock WhatsApp: the simulator page reads the `messages` table, so the stored row IS the delivery.
 */
export class MockWhatsAppChannel implements MessagingChannel {
  readonly name = 'mock-whatsapp';
  readonly queued = false;
  async send(): Promise<void> {
    /* stored message row is the delivery */
  }
}

/** Mock speech for demos and tests: "audio" is just UTF-8 text, so the voice flow works without a vendor. */
export class MockSpeechToText implements SpeechToText {
  readonly name = 'mock-stt';
  async transcribe(audio: Buffer, opts: { languageHint?: Lang }) {
    const text = audio.toString('utf8');
    return {
      text,
      language: /[ऀ-ॿ]/.test(text) ? ('hi' as const) : (opts.languageHint ?? ('en' as const)),
    };
  }
}
export class MockTextToSpeech implements TextToSpeech {
  readonly name = 'mock-tts';
  async synthesize(text: string) {
    return { audio: Buffer.from(text, 'utf8'), mimeType: 'text/plain' };
  }
}
