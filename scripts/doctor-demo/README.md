# Doctor demonstration video

Produces a Hinglish walkthrough with English captions from the working demo presentation.
All patient details are fictional. Booking, arrival, queue, note approval and feedback
use actual application services in the disposable end-to-end test database.
Outbound messages are previews; no real messages, calls or payments are made.

## Render on macOS

Prerequisites: the repository's end-to-end test dependencies and local database,
the installed macOS Hindi voice `Lekha`, and a full FFmpeg build with H.264/AAC.

1. `python3 scripts/doctor-demo/narrate.py`
2. `DEMO_VIDEO=1 pnpm e2e e2e/doctor-video.spec.ts`
3. `python3 scripts/doctor-demo/render.py --ffmpeg /path/to/ffmpeg`

The macOS speech service must be accessible to `say`; a restricted sandbox may
produce an empty audio file. The narration script checks audio duration.

Outputs are ignored by Git under `artifacts/doctor-demo/`:

- `Sahayak-Doctor-Demo-Hinglish.mp4`: 1080p video, synthetic Hinglish narration,
  English captions embedded in the picture.
- `Sahayak-Doctor-Demo-English.srt`: approximate English subtitle timings.
- `README.md`: chapter timestamps and demonstration scope.
- `work/`: intermediate narration, raw recording, timeline and scene screenshots.

Edit `scenes.json` for narration. The `spoken` lines are Hinglish written in
Devanagari for pronunciation; `narration` contains the corresponding English captions.
The recording test is skipped unless `DEMO_VIDEO=1` is set.

## Clinic and hospital owner edition

Set `DEMO_AUDIENCE=owner` for all three commands:

```sh
DEMO_AUDIENCE=owner python3 scripts/doctor-demo/narrate.py
DEMO_AUDIENCE=owner DEMO_VIDEO=1 pnpm e2e e2e/doctor-video.spec.ts
DEMO_AUDIENCE=owner python3 scripts/doctor-demo/render.py --ffmpeg /path/to/ffmpeg
```

This edition uses `owner-scenes.json` and saves separately under
`artifacts/owner-demo/Sahayak-Owner-Demo-Hinglish.mp4`, preserving the doctor edition.
It explains assistant responsibilities, the same actual saved patient journey,
staff responsibilities and a suggested pilot. Workload and staffing benefits are
potential benefits to measure; no headcount reduction, ROI or patient retention
result is claimed. The closing measurement cards are guidance, not a product dashboard.

## Doctor everyday-workflow revision

Use `DEMO_AUDIENCE=workflow` in the three render commands for the revised doctor
video, without owner staffing or pilot advice. It uses `workflow-scenes.json` and
outputs `artifacts/workflow-demo/Sahayak-Workflow-Demo-Hinglish.mp4`.

The delay and cancellation cards display actual results from the normal schedule,
simulator, cancellation and waiting-list APIs. The dedicated scenario uses a second
fictional clinic so it does not disrupt the main consultation journey. Its clock is
set to daytime in the disposable database to exercise the normal offering-hours gate.
Times shown on these cards are that demo clinic's local times. No real message is sent.

`pnpm e2e e2e/video-disruptions.spec.ts` verifies proposal-before-confirmation,
30-minute shifts, a patient keeping the new time, cancellation, an expiring offer,
acceptance and rejection of duplicate acceptance. The video does not claim to test
microphone transcription or live WhatsApp delivery; it submits the doctor's words
as text through the same late-request parser.

## Recorded English app demonstrations

`record-english-live.mjs` records the local app with fictional clinic logins. It saves a complete patient journey, including the delay and approved-instruction page, and a separate tour of existing capability screens. It does not send external messages or payments. Browser speech is off.

`render-english-live.py` needs `edge-tts` and `imageio-ffmpeg`. It generates English narration from the public script using Sonia's synthetic English voice, pads recorded screen segments to match the speech, and produces two MP4 files, WebVTT captions and chapter metadata. Only the narration script is sent to the speech service.

Render outputs are in ignored `artifacts/english-live-demo/`. Finished playback copies in `apps/web/public/demo-videos/` are now committed so a fresh clone can play them. Open `/demo/videos` to play, pause, seek, select captions or download. Other finished editions, including the revised English voice with three-second pauses, are committed under `demo-media/`. See `docs/windows-setup.md` for laptop migration. Intermediate render files remain local.
