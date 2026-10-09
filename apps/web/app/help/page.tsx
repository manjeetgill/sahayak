'use client';
import { ClinicShell } from '../components/ClinicShell';
import { useSession } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';

type Task = { q: string; a: string; href?: string; go?: string };
const DOCTOR: Task[] = [
  {
    q: 'See the next patient',
    a: 'Press "Next patient" on Today. The patient\'s card appears at the top.',
    href: '/doctor',
    go: 'Open Today',
  },
  {
    q: 'Write a visit note',
    a: 'Open the patient, choose the Visit tab, then speak or type. The assistant arranges your words under headings; you review and sign.',
    href: '/doctor#patient-search',
    go: 'Find a patient',
  },
  {
    q: 'Write a prescription or certificate',
    a: 'On the Visit tab, below the note. You review it and sign with your password before anything reaches the patient.',
  },
  {
    q: "I'm running late",
    a: 'On Today, type how late you are under "Running late?". You see who is affected and nothing is sent until you confirm.',
    href: '/doctor',
    go: 'Open Today',
  },
  {
    q: 'Ask about the clinic',
    a: 'Ask in plain words, for example "who did not show up yesterday?".',
    href: '/doctor#ask-clinic',
    go: 'Ask your clinic',
  },
  {
    q: 'Something needs my attention',
    a: 'The inbox lists urgent alerts, reports and unsigned drafts, most urgent first.',
    href: '/doctor/inbox',
    go: 'Open the inbox',
  },
];
const RECEPTION: Task[] = [
  {
    q: 'Check in a patient',
    a: 'Press "Check in patient" on Today and enter their mobile number.',
    href: '/console',
    go: 'Open Today',
  },
  {
    q: 'A patient scanned the QR code',
    a: 'QR arrivals shows who has arrived and what is still to do.',
    href: '/console/arrivals',
    go: 'Open QR arrivals',
  },
  {
    q: 'A patient asks for a person',
    a: 'Open Conversations, take over the chat and reply. The assistant stays quiet until you hand it back.',
    href: '/console#conversations',
    go: 'Open Conversations',
  },
  {
    q: 'Someone cancelled',
    a: 'The waiting list offers the free slot to the next patient automatically.',
    href: '/doctor/waitlist',
    go: 'Open the waiting list',
  },
  {
    q: 'A patient wants their data deleted',
    a: 'Use Privacy requests to find the patient and export or erase their data.',
    href: '/console/privacy',
    go: 'Open Privacy requests',
  },
];
const ADMIN: Task[] = [
  {
    q: 'Finish setting up the clinic',
    a: 'The setup checklist shows what is still needed before patients use it.',
    href: '/admin/setup',
    go: 'Open the checklist',
  },
  {
    q: 'Add a doctor or receptionist',
    a: 'Doctors & team lets you add people and set their access.',
    href: '/admin/team',
    go: 'Open Doctors & team',
  },
  {
    q: 'Connect WhatsApp, calls or Google',
    a: 'Connections guides you step by step and shows whether each service is working.',
    href: '/admin/integrations',
    go: 'Open Connections',
  },
];

const HELP_HI: Record<string, string> = {
  'See the next patient': 'अगले मरीज़ को कैसे बुलाएँ?',
  'Press "Next patient" on Today. The patient\'s card appears at the top.': 'आज के पेज पर “अगला मरीज़” दबाएँ। मरीज़ का कार्ड ऊपर दिखाई देगा।',
  'Open Today': 'आज का पेज खोलें',
  'Write a visit note': 'मुलाक़ात का नोट कैसे लिखें?',
  'Open the patient, choose the Visit tab, then speak or type. The assistant arranges your words under headings; you review and sign.': 'मरीज़ का रिकॉर्ड खोलें, मुलाक़ात टैब चुनें, फिर बोलें या लिखें। सहायक आपके शब्दों को शीर्षकों में रखेगा; आप जाँचकर हस्ताक्षर करें।',
  'Write a prescription or certificate': 'पर्चा या प्रमाणपत्र कैसे लिखें?',
  'On the Visit tab, below the note. You review it and sign with your password before anything reaches the patient.': 'मुलाक़ात टैब में नोट के नीचे जाएँ। मरीज़ तक पहुँचने से पहले आप दस्तावेज़ जाँचते हैं और पासवर्ड से हस्ताक्षर करते हैं।',
  "I'm running late": 'मुझे देर हो रही है',
  'On Today, type how late you are under "Running late?". You see who is affected and nothing is sent until you confirm.': 'आज के पेज पर “देर हो रही है?” में देरी लिखें। प्रभावित मरीज़ दिखेंगे। आपकी पुष्टि से पहले कोई संदेश नहीं भेजा जाएगा।',
  'Ask about the clinic': 'क्लिनिक के बारे में कैसे पूछें?',
  'Ask in plain words, for example "who did not show up yesterday?".': 'साधारण भाषा में पूछें, जैसे “कल कौन नहीं आया था?”',
  'Something needs my attention': 'किसी काम पर मेरा ध्यान चाहिए',
  'The inbox lists urgent alerts, reports and unsigned drafts, most urgent first.': 'काम की सूची में तत्काल चेतावनियाँ, रिपोर्ट और बिना हस्ताक्षर के मसौदे सबसे ज़रूरी के क्रम में दिखते हैं।',
  'Open the inbox': 'काम की सूची खोलें',
  'Check in a patient': 'मरीज़ को चेक-इन कैसे करें?',
  'Press "Check in patient" on Today and enter their mobile number.': 'आज के पेज पर “मरीज़ चेक-इन करें” दबाएँ और उनका मोबाइल नंबर लिखें।',
  'A patient scanned the QR code': 'मरीज़ ने QR कोड स्कैन किया',
  'QR arrivals shows who has arrived and what is still to do.': 'QR आगमन में दिखता है कि कौन आया और क्या काम बाकी है।',
  'Open QR arrivals': 'QR आगमन खोलें',
  'A patient asks for a person': 'मरीज़ किसी व्यक्ति से बात करना चाहता है',
  'Open Conversations, take over the chat and reply. The assistant stays quiet until you hand it back.': 'बातचीत खोलें, चैट अपने हाथ में लेकर जवाब दें। वापस सौंपने तक सहायक चुप रहेगा।',
  'Open Conversations': 'बातचीत खोलें',
  'Someone cancelled': 'किसी ने मुलाक़ात रद्द की',
  'The waiting list offers the free slot to the next patient automatically.': 'प्रतीक्षा सूची अगले मरीज़ को खाली समय अपने आप देती है।',
  'Open the waiting list': 'प्रतीक्षा सूची खोलें',
  'A patient wants their data deleted': 'मरीज़ अपना डेटा हटवाना चाहता है',
  'Use Privacy requests to find the patient and export or erase their data.': 'गोपनीयता अनुरोध में मरीज़ को खोजकर उनका डेटा डाउनलोड या मिटाएँ।',
  'Open Privacy requests': 'गोपनीयता अनुरोध खोलें',
  'Finish setting up the clinic': 'क्लिनिक की सेटिंग कैसे पूरी करें?',
  'The setup checklist shows what is still needed before patients use it.': 'सेटिंग की सूची दिखाती है कि मरीज़ों के उपयोग से पहले क्या बाकी है।',
  'Open the checklist': 'सेटिंग सूची खोलें',
  'Add a doctor or receptionist': 'डॉक्टर या रिसेप्शनिस्ट कैसे जोड़ें?',
  'Doctors & team lets you add people and set their access.': 'डॉक्टर और टीम में लोग जोड़ें और उनकी पहुँच तय करें।',
  'Open Doctors & team': 'डॉक्टर और टीम खोलें',
  'Connect WhatsApp, calls or Google': 'WhatsApp, कॉल या Google कैसे जोड़ें?',
  'Connections guides you step by step and shows whether each service is working.': 'कनेक्शन पेज आपको चरण दर चरण बताता है और दिखाता है कि हर सेवा चल रही है या नहीं।',
  'Open Connections': 'कनेक्शन खोलें',
  'How do I…?': 'मैं यह कैसे करूँ?',
  'Short answers for the things you do every day.': 'रोज़ के कामों के छोटे और सीधे जवाब।',
  'Something looks wrong?': 'कुछ ठीक नहीं लग रहा?',
  'Tell your clinic admin what you were doing and what you saw. The safety report shows what the assistants have done and whether anything needs attention.': 'क्लिनिक एडमिन को बताएँ कि आप क्या कर रहे थे और क्या देखा। सुरक्षा रिपोर्ट दिखाती है कि सहायकों ने क्या किया और किस पर ध्यान चाहिए।',
  'Open the safety report': 'सुरक्षा रिपोर्ट खोलें',
};

/** Plain answers to "how do I...?", with a link straight to the right place. */
export default function Help() {
  const s = useSession();
  const { x, lang } = useStaffLang();
  const helpX = (en: string) => lang === 'hi' ? (HELP_HI[en] ?? x(en)) : en;
  if (!s) return null;
  const tasks =
    s.user.role === 'admin' ? ADMIN : s.user.role === 'receptionist' ? RECEPTION : DOCTOR;
  return (
    <ClinicShell>
      <div className="help-page">
        <header className="doctor-page-heading">
          <div>
            <span className="page-eyebrow">{x('Help')}</span>
            <h1>{helpX('How do I…?')}</h1>
            <p className="muted">{helpX('Short answers for the things you do every day.')}</p>
          </div>
        </header>
        <div className="list" data-testid="help-list">
          {tasks.map((t) => (
            <section key={t.q} className="card" style={{ marginBottom: '.8rem' }}>
              <h2>{helpX(t.q)}</h2>
              <p>{helpX(t.a)}</p>
              {t.href && (
                <a className="button-link" href={t.href}>
                  {helpX(t.go || '')} →
                </a>
              )}
            </section>
          ))}
        </div>
        <section className="card">
          <h2>{helpX('Something looks wrong?')}</h2>
          <p>
            {helpX('Tell your clinic admin what you were doing and what you saw. The safety report shows what the assistants have done and whether anything needs attention.')}
          </p>
          {s.user.role !== 'admin' && (
            <a className="button-link" href="/safety">
              {helpX('Open the safety report')} →
            </a>
          )}
        </section>
      </div>
    </ClinicShell>
  );
}
