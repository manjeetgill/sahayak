'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { staff } from '../../../../lib/api';
type Setup = { phone: string; faq: string; state: string; preparation?: string };
type Status = {
  setup: Setup | null;
  platformConfigured: boolean;
  onboardingAvailable?: boolean;
  bridgeConfigured?: boolean;
  liveRepliesEnabled: boolean;
};
const labels: Record<string, string> = {
  REQUESTED: 'Details saved — ready for authorization',
  STARTING: 'Preparing authorization — setup team review required if interrupted',
  CONNECTING: 'Owner authorization in progress',
  OWNERSHIP_CHECK_REQUIRED: 'Owner authorization received — setup team verifying the number',
  CHECK_REQUIRED: 'Setup team needs to check the interrupted connection',
  CONNECTED: 'Number ownership verified — preparing your appointment assistant',
};
export function WhatsAppSetup({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<Status | null>(null),
    [phone, setPhone] = useState(''),
    [faq, setFaq] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const containerId = 'chakra-connect-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const container = useRef<HTMLDivElement>(null),
    widget = useRef<{ destroy: () => void } | null>(null);
  async function load() {
    const s = await staff<Status>('/staff/agents/whatsapp/setup');
    setStatus(s);
    setPhone(s.setup?.phone ?? '');
    setFaq(s.setup?.faq ?? '');
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    return () => widget.current?.destroy();
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    await staff('/staff/agents/whatsapp/refresh', {});
    await load();
  }
  useEffect(() => {
    if (
      !canManage ||
      !['CONNECTING', 'OWNERSHIP_CHECK_REQUIRED'].includes(status?.setup?.state ?? '')
    )
      return;
    let running = false,
      stopped = false;
    const timer = setInterval(async () => {
      if (running || stopped) return;
      running = true;
      try {
        await refresh();
      } catch (e: any) {
        stopped = true;
        setError(e.message);
      } finally {
        running = false;
      }
    }, 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [canManage, status?.setup?.state]);
  async function save() {
    await staff(
      '/staff/agents/whatsapp/setup',
      { phone: phone.replace(/[\s()-]/g, ''), faq },
      'PUT',
    );
    await load();
  }
  async function connect() {
    const session = await staff('/staff/agents/whatsapp/connect', {});
    await load();
    const w = window as unknown as {
      ChakraWhatsappConnect?: { init: (o: Record<string, unknown>) => { destroy: () => void } };
    };
    if (!w.ChakraWhatsappConnect)
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://embed.chakrahq.com/whatsapp-partner-connect/v1_0_1/sdk.js';
        script.onload = () => resolve();
        script.onerror = () =>
          reject(
            new Error(
              'Authorization could not load. Ask your setup team to check the saved connection.',
            ),
          );
        document.head.appendChild(script);
      });
    widget.current?.destroy();
    widget.current = w.ChakraWhatsappConnect!.init({
      connectToken: session.connect_token,
      container: `#${containerId}`,
      onError: () => setError('Authorization interrupted. Check status before starting again.'),
      onSuccess: (data: { pluginId: string }) =>
        void run(async () => {
          await staff('/staff/agents/whatsapp/complete', { plugin_id: data.pluginId });
          await refresh();
        }),
    });
  }
  const phase = status?.setup?.preparation;
  const phaseLabel: Record<string, string> = {
    UNAVAILABLE:
      'Agent service unavailable. Your number is saved. Check connection status when the service returns.',
    PREPARING: 'Preparing the standard appointment assistant',
    WEBHOOK_PENDING:
      'Send Hi to the clinic number from a second WhatsApp number, then check connection status. Replies are still paused.',
    READY: 'Webhook verified. You can enable replies and test a booking.',
    ACTIVE:
      'WhatsApp replies are enabled. Send Hi from a second number to test booking in Sahayak.',
  };
  const editable = canManage && (!status?.setup || status.setup.state === 'REQUESTED');
  return (
    <section className="card" aria-label="Connect your clinic WhatsApp">
      <h3>Connect your clinic WhatsApp</h3>
      <p>
        Give us your business number. The owner authorizes WhatsApp and completes the OTP. We supply
        the standard appointment conversation using your doctor schedules in Sahayak.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status">
        {status?.setup
          ? (phaseLabel[phase ?? ''] ?? labels[status.setup.state])
          : 'Start with your clinic number.'}
      </p>
      <label>
        Business WhatsApp number (including country code)
        <input
          type="tel"
          placeholder="+919876543210"
          value={phone}
          disabled={!editable || busy}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <p>
        <strong>Included appointment flow:</strong> welcome → book appointment → first visit or
        follow-up → doctor → available time → patient confirms. Set doctor hours and slot lengths in
        Sahayak; you do not need to design an agent or write FAQs.
      </p>
      {editable && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await save();
              if (status?.onboardingAvailable) await connect();
            })
          }
        >
          {status?.onboardingAvailable ? 'Save and connect WhatsApp' : 'Save clinic number'}
        </button>
      )}
      {canManage && status?.setup?.state === 'CONNECTING' && (
        <button disabled={busy} onClick={() => void run(connect)}>
          Continue owner authorization
        </button>
      )}
      {canManage &&
        status?.setup?.state === 'CONNECTED' &&
        !['READY', 'ACTIVE'].includes(phase ?? '') && (
          <button disabled={busy} onClick={() => void run(refresh)}>
            Finish connection / check test message
          </button>
        )}
      {canManage && phase === 'READY' && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await staff('/staff/agents/whatsapp/activation', { enabled: true });
              await load();
            })
          }
        >
          Enable WhatsApp replies
        </button>
      )}
      {canManage && phase === 'ACTIVE' && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await staff('/staff/agents/whatsapp/activation', { enabled: false });
              await load();
            })
          }
        >
          Pause WhatsApp replies
        </button>
      )}
      {status?.platformConfigured &&
        !status.onboardingAvailable &&
        status?.setup?.state !== 'CONNECTED' && (
          <p role="status">
            Your setup team is finishing WhatsApp authorization setup. You can save your number now.
          </p>
        )}
      {status && !status.platformConfigured && (
        <p>
          Your details can be saved now. Your setup team must enable the clinic’s platform
          connection before authorization.
        </p>
      )}
      {canManage && status?.setup && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await staff('/staff/agents/whatsapp/refresh', {});
              await load();
            })
          }
        >
          Check connection status
        </button>
      )}
      <div id={containerId} ref={container} />
      <ol aria-label="WhatsApp setup progress">
        <li>Add clinic number and doctor timings.</li>
        <li>Owner completes Meta/Chakra authorization and phone verification.</li>
        <li>We verify number ownership; Sahayak prepares the standard booking assistant.</li>
        <li>Send a test message, check connection status, and enable replies.</li>
      </ol>
      {!status?.bridgeConfigured && (
        <p>
          Your setup team must configure the shared secure Sahayak connection once before live setup
          can finish.
        </p>
      )}
      <p>
        No API keys, webhooks, or agent prompts are needed from the clinic. Number ownership review
        remains required before activation.
      </p>
    </section>
  );
}
