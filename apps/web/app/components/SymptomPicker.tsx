'use client';
import { useMemo, useState } from 'react';
import { useStaffLang } from '../../lib/staffText';

const GROUPS: { group: string; hi: string; symptoms: [string, string][] }[] = [
  {
    group: 'General',
    hi: 'सामान्य',
    symptoms: [
      ['Fever', 'बुखार'],
      ['Fatigue', 'थकान'],
      ['Chills', 'ठंड लगना'],
      ['Weight loss', 'वज़न कम होना'],
      ['Weight gain', 'वज़न बढ़ना'],
      ['Loss of appetite', 'भूख कम लगना'],
      ['Body pain', 'बदन दर्द'],
    ],
  },
  {
    group: 'Breathing and chest',
    hi: 'सांस और छाती',
    symptoms: [
      ['Cough', 'खांसी'],
      ['Sore throat', 'गले में दर्द'],
      ['Runny nose', 'नाक बहना'],
      ['Breathlessness', 'सांस फूलना'],
      ['Chest pain', 'सीने में दर्द'],
      ['Wheezing', 'घरघराहट'],
      ['Palpitations', 'धड़कन तेज़ होना'],
    ],
  },
  {
    group: 'Stomach and digestion',
    hi: 'पेट और पाचन',
    symptoms: [
      ['Abdominal pain', 'पेट दर्द'],
      ['Nausea', 'जी मिचलाना'],
      ['Vomiting', 'उल्टी'],
      ['Diarrhoea', 'दस्त'],
      ['Constipation', 'कब्ज़'],
      ['Acidity', 'एसिडिटी'],
      ['Blood in stool', 'मल में खून'],
      ['Difficulty swallowing', 'निगलने में कठिनाई'],
    ],
  },
  {
    group: 'Head, nerves and mood',
    hi: 'सिर और तंत्रिका',
    symptoms: [
      ['Headache', 'सिरदर्द'],
      ['Dizziness', 'चक्कर'],
      ['Fainting', 'बेहोशी'],
      ['Weakness', 'कमज़ोरी'],
      ['Numbness', 'सुन्न होना'],
      ['Sleep difficulty', 'नींद में कठिनाई'],
      ['Anxiety', 'घबराहट'],
      ['Low mood', 'मूड खराब'],
    ],
  },
  {
    group: 'Urine and reproductive',
    hi: 'पेशाब और प्रजनन',
    symptoms: [
      ['Burning urination', 'पेशाब में जलन'],
      ['Frequent urination', 'बार-बार पेशाब'],
      ['Blood in urine', 'पेशाब में खून'],
      ['Missed period', 'मासिक धर्म न आना'],
      ['Heavy periods', 'अधिक मासिक रक्तस्राव'],
      ['Pelvic pain', 'पेल्विक दर्द'],
    ],
  },
  {
    group: 'Skin, joints and other',
    hi: 'त्वचा, जोड़ और अन्य',
    symptoms: [
      ['Rash', 'दाने'],
      ['Itching', 'खुजली'],
      ['Swelling', 'सूजन'],
      ['Joint pain', 'जोड़ दर्द'],
      ['Back pain', 'कमर दर्द'],
      ['Ear pain', 'कान दर्द'],
      ['Eye redness', 'आंख लाल होना'],
      ['Blurred vision', 'धुंधला दिखना'],
    ],
  },
];

export function SymptomPicker({ onAdd }: { onAdd: (symptoms: string[]) => void }) {
  const { lang } = useStaffLang();
  const hi = lang === 'hi';
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const shown = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        symptoms: group.symptoms.filter(([en, hindi]) =>
          `${en} ${hindi}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        ),
      })).filter((group) => group.symptoms.length),
    [search],
  );
  const toggle = (value: string) =>
    setSelected((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  const add = () => {
    const translated = new Map(GROUPS.flatMap((group) => group.symptoms));
    const symptoms = [
      ...selected.map((name) => (hi ? translated.get(name) ?? name : name)),
      ...other
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ];
    if (!symptoms.length) return;
    onAdd(symptoms);
    setSelected([]);
    setOther('');
  };
  return (
    <details className="symptom-picker">
      <summary>{hi ? 'मरीज़ के बताए लक्षण चुनें' : 'Pick symptoms the patient reported'}</summary>
      <p className="muted">
        {hi
          ? 'यह केवल नोट में बताई गई शिकायत जोड़ता है। इससे निदान या दवा अपने आप नहीं चुनी जाती।'
          : 'This adds reported symptoms to the note. It does not choose a diagnosis or medicine.'}
      </p>
      <input
        aria-label={hi ? 'लक्षण खोजें' : 'Find a symptom'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={hi ? 'लक्षण खोजें' : 'Find a symptom'}
      />
      {shown.map((group) => (
        <div key={group.group}>
          <b>{hi ? group.hi : group.group}</b>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, margin: '6px 0 12px' }}>
            {group.symptoms.map(([en, hindi]) => (
              <button
                key={en}
                type="button"
                className={selected.includes(en) ? 'small' : 'small ghost'}
                aria-pressed={selected.includes(en)}
                onClick={() => toggle(en)}
              >
                {hi ? hindi : en}
              </button>
            ))}
          </div>
        </div>
      ))}
      <label>
        {hi ? 'अन्य लक्षण (अल्पविराम से अलग करें)' : 'Other symptoms (separate with commas)'}
        <input value={other} onChange={(e) => setOther(e.target.value)} />
      </label>
      <button type="button" disabled={!selected.length && !other.trim()} onClick={add}>
        {hi ? 'नोट में जोड़ें' : 'Add to note'}
      </button>
    </details>
  );
}
