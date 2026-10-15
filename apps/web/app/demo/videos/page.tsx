'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
export default function DemoVideos() {
  const [report, setReport] = useState<
    Record<string, { duration: number; chapters: { title: string; seconds: number }[] }>
  >({});
  useEffect(() => {
    fetch('/demo-videos/report.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setReport)
      .catch(() => {});
  }, []);
  return (
    <main className="wrap" style={{ maxWidth: 1100 }}>
      <Link href="/demo">← Demo home</Link>
      <h1>Sahayak — English video demonstrations</h1>
      <p>
        See how Sahayak connects a patient’s visit and helps the clinic team manage the day. English
        narration follows working examples in a demonstration clinic.
      </p>
      {[
        [
          'patient-journey',
          '1. The complete patient journey',
          'Booking, a doctor delay, arrival, payment record, queue, approved instructions, feedback and follow-up.',
        ],
        [
          'platform-capabilities',
          '2. How Sahayak helps your clinic',
          'A tour of assistant controls, clinic operations, care tasks, feedback, payments and connected-service setup.',
        ],
      ].map(([id, title, description]) => (
        <section className="card" key={id} style={{ marginTop: 24 }}>
          <h2>{title}</h2>
          <p>{description}</p>
          {report[id] && (
            <p>
              {Math.floor(report[id].duration / 60)} min {Math.round(report[id].duration % 60)} sec
              · English narration
            </p>
          )}
          <video
            id={id}
            controls
            onPlay={(event) => {
              const current = event.currentTarget;
              document.querySelectorAll('video').forEach((video) => {
                if (video !== current) video.pause();
              });
            }}
            playsInline
            preload="metadata"
            style={{ width: '100%', background: '#123a2e', borderRadius: 12 }}
          >
            <source
              src={`/demo-videos/Sahayak-${id}-English.mp4?v=clinic-team-3`}
              type="video/mp4"
            />
            <track
              kind="captions"
              src={`/demo-videos/Sahayak-${id}-English.vtt?v=clinic-team-3`}
              srcLang="en"
              label="English"
            />
          </video>
          <p>
            <a href={`/demo-videos/Sahayak-${id}-English.mp4`} download>
              Download this video
            </a>
          </p>
          <details>
            <summary>Jump to a chapter</summary>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {report[id]?.chapters.map((c) => (
                <button
                  className="ghost"
                  key={c.title}
                  onClick={() => {
                    const v = document.getElementById(id) as HTMLVideoElement;
                    v.currentTime = c.seconds;
                    void v.play().catch(() => {});
                  }}
                >
                  {c.title}
                </button>
              ))}
            </div>
          </details>
        </section>
      ))}
      <p>
        Follow a complete visit, or explore the tools that reduce repeated work and help the clinic
        team keep track of patient care. Use the chapters to jump to a topic.
      </p>
    </main>
  );
}
