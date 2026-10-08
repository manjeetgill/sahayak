'use client';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'sahayak.staffLang';
export type StaffLang = 'en' | 'hi';

/**
 * Hindi for the everyday staff screens (navigation, Today at the doctor's desk and at reception). Keyed by the
 * English text; anything not listed stays English. First pass: have a native speaker review before wide release.
 */
const HI: Record<string, string> = {
  'My assistants': 'मेरे सहायक',
  Today: 'आज',
  Patients: 'मरीज़',
  Care: 'देखभाल',
  Clinic: 'क्लिनिक',
  Conversations: 'बातचीत',
  'QR arrivals': 'QR से आगमन',
  'Waiting list': 'प्रतीक्षा सूची',
  'Patient check-ins': 'मरीज़ चेक-इन',
  'Privacy requests': 'गोपनीयता अनुरोध',
  'My profile': 'मेरी प्रोफ़ाइल',
  'Safety & privacy': 'सुरक्षा और गोपनीयता',
  'Sign out': 'साइन आउट',
  Help: 'सहायता',
  'Clinic workspace': 'क्लिनिक वर्कस्पेस',
  Doctor: 'डॉक्टर',
  Receptionist: 'रिसेप्शनिस्ट',
  Admin: 'एडमिन',
  'Find a patient by name or phone': 'नाम या फ़ोन से मरीज़ खोजें',
  'Open reception workspace': 'रिसेप्शन वर्कस्पेस खोलें',
  "Today's clinic": 'आज का क्लिनिक',
  'Good morning': 'सुप्रभात',
  'Good afternoon': 'नमस्कार',
  'Good evening': 'शुभ संध्या',
  'Your next patient and outstanding work are together here.':
    'आपका अगला मरीज़ और बाकी काम यहाँ एक साथ हैं।',
  'Now seeing': 'अभी देख रहे हैं',
  'Patient is here': 'मरीज़ आ गए',
  'Open record and write note →': 'रिकॉर्ड खोलें और नोट लिखें →',
  'Open record': 'रिकॉर्ड खोलें',
  More: 'और',
  'Nothing needs your attention.': 'आपके ध्यान के लिए कुछ नहीं है।',
  'No patient in the room. Press Next patient.': 'कमरे में कोई मरीज़ नहीं है। "अगला मरीज़" दबाएँ।',
  Booked: 'बुक',
  Seen: 'देखे गए',
  Waiting: 'प्रतीक्षा में',
  'Checked in': 'चेक-इन',
  'Running late?': 'देर हो रही है?',
  'Preview affected patients before sending.': 'भेजने से पहले प्रभावित मरीज़ देखें।',
  'Check impact': 'असर देखें',
  'Quick actions': 'त्वरित कार्य',
  'Find patient': 'मरीज़ खोजें',
  'Create care task': 'देखभाल कार्य बनाएँ',
  'Clinic overview': 'क्लिनिक का सार',
  Reception: 'रिसेप्शन',
  'Today at the front desk': 'आज का रिसेप्शन',
  'Messages that need a person or clinic review.':
    'जिन संदेशों पर किसी व्यक्ति या क्लिनिक की नज़र चाहिए।',
  'Check in patients, manage the queue and answer clinic messages.':
    'मरीज़ों को चेक-इन करें, कतार संभालें और क्लिनिक के संदेशों का जवाब दें।',
  'Check in patient': 'मरीज़ चेक-इन करें',
  'Conversations needing a reply': 'जवाब चाहने वाली बातचीत',
  'View all': 'सब देखें',
  'Safety report': 'सुरक्षा रिपोर्ट',
  'Nothing needs attention.': 'किसी ध्यान की ज़रूरत नहीं।',
  'Patients waiting': 'प्रतीक्षा में मरीज़',
  'Ask your clinic': 'अपने क्लिनिक से पूछें',
  'Needs your attention': 'आपके ध्यान के लिए',
};

const EVENT = 'sahayak-staff-lang';
export function useStaffLang() {
  const [lang, setLangState] = useState<StaffLang>('en');
  useEffect(() => {
    const read = () => {
      try {
        setLangState(localStorage.getItem(KEY) === 'hi' ? 'hi' : 'en');
      } catch {
        /* storage blocked */
      }
    };
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  const setLang = useCallback((l: StaffLang) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* storage blocked: language lasts for this page only */
    }
    setLangState(l);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  /** Translate a UI string; unknown strings stay as written. */
  const x = useCallback((en: string) => (lang === 'hi' ? (HI[en] ?? en) : en), [lang]);
  return { lang, setLang, x };
}
