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
