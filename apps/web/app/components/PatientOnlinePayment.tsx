'use client';
import { useState } from 'react';
import { api } from '../../lib/api';
let checkoutScript: Promise<void> | undefined;
function loadCheckout() {
  if ((window as any).Razorpay) return Promise.resolve();
  if (!checkoutScript)
    checkoutScript = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        checkoutScript = undefined;
        reject(Error('Payment screen could not load. Try again or contact reception.'));
      };
      document.head.appendChild(s);
    });
  return checkoutScript;
}
export function PatientOnlinePayment({
  slug,
  token,
  mode,
  onlineState,
  enabled,
  hi,
}: {
  slug: string;
  token: string;
  mode: string;
  onlineState?: string;
  enabled: boolean;
  hi: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const t = (en: string, hn: string) => (hi ? hn : en);
  async function check() {
    setBusy(true);
    setError('');
    try {
      const r = await api(`/public/${slug}/arrival/payment/status`, {
        body: { accessToken: token },
      });
      setMessage(
        r.state === 'captured'
          ? t(
              'Payment verified. Your queue token will appear shortly.',
              'भुगतान की पुष्टि हो गई। टोकन जल्द दिखेगा।',
            )
          : r.state === 'review'
            ? t(
                'Reception needs to review this payment. Do not pay again.',
                'रिसेप्शन से भुगतान की जांच करवाएं। दोबारा भुगतान न करें।',
              )
            : t(
                'Payment has not been confirmed yet. Do not pay again if money was deducted.',
                'भुगतान की पुष्टि अभी नहीं हुई। पैसे कट गए हैं तो दोबारा भुगतान न करें।',
              ),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    setBusy(true);
    setError('');
    try {
      await loadCheckout();
      const order = await api(`/public/${slug}/arrival/payment/order`, {
        body: { accessToken: token },
      });
      const checkout = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'Clinic payment',
        description: 'Consultation fee',
        modal: { ondismiss: () => setBusy(false) },
        handler: async (result: any) => {
          try {
            const r = await api(`/public/${slug}/arrival/payment/verify`, {
              body: {
                accessToken: token,
                paymentId: result.razorpay_payment_id,
                signature: result.razorpay_signature,
              },
            });
            setMessage(
              r.state === 'captured'
                ? t(
                    'Payment verified. Your queue token will appear shortly.',
                    'भुगतान की पुष्टि हो गई। टोकन जल्द दिखेगा।',
                  )
                : t(
                    'Checking payment. Do not pay again. Use Check payment status.',
                    'भुगतान की जांच हो रही है। दोबारा भुगतान न करें।',
                  ),
            );
          } catch (e: any) {
            setError(
              e.message +
                ' ' +
                t(
                  'Do not pay again; check payment status.',
                  'दोबारा भुगतान न करें; भुगतान की स्थिति जांचें।',
                ),
            );
          } finally {
            setBusy(false);
          }
        },
      });
      checkout.on('payment.failed', () => {
        setBusy(false);
        setError(
          t(
            'Payment was not completed. Check status if money was deducted.',
            'भुगतान पूरा नहीं हुआ। पैसे कटे हैं तो स्थिति जांचें।',
          ),
        );
      });
      checkout.open();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <section aria-label="Online payment">
      <h3>{t('Pay online', 'ऑनलाइन भुगतान')}</h3>
      {mode === 'test' && (
        <p>
          <strong>{t('Test mode — no real money', 'टेस्ट मोड — असली पैसे नहीं')}</strong>
        </p>
      )}
      {onlineState === 'review' ? (
        <p>
          {t(
            'Payment needs reception review. Do not pay again.',
            'रिसेप्शन से भुगतान की जांच करवाएं। दोबारा भुगतान न करें।',
          )}
        </p>
      ) : (
        <p>
          <button
            disabled={
              busy || !enabled || ['creating', 'unknown', 'captured'].includes(onlineState ?? '')
            }
            onClick={() => void pay()}
          >
            {busy
              ? t('Checking…', 'जांच हो रही है…')
              : t('Pay securely with Razorpay', 'Razorpay से भुगतान करें')}
          </button>
        </p>
      )}
      <button className="ghost" disabled={busy} onClick={() => void check()}>
        {t('Check payment status', 'भुगतान की स्थिति जांचें')}
      </button>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
