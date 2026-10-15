"""Replace demo narration with neural English speech, preserving existing visuals.

Run using a Python environment with edge-tts and imageio-ffmpeg installed.
Only the public demo narration is sent to the speech service.
"""
import ast
import asyncio
import json
import pathlib
import re
import subprocess

import edge_tts
import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = ROOT / 'artifacts/doctor-demo'
OUT = BASE / 'english-refined'
WORK = OUT / 'work'
WORK.mkdir(parents=True, exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = 'en-GB-SoniaNeural'
PAUSE_SECONDS = 3.0

def run(args):
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True)

def duration(path):
    p = subprocess.run([FF, '-i', str(path)], capture_output=True, text=True)
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', p.stderr)
    if not m:
        raise RuntimeError(f'Cannot measure {path}')
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])

async def main():
    caps = json.loads((ROOT / 'scripts/doctor-demo/capabilities-scenes.json').read_text())
    tree = ast.parse((ROOT / 'scripts/doctor-demo/build-bilingual.py').read_text())
    english = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'english' for t in n.targets))
    films = {'capabilities': {s['id']: s['narration'] for s in caps}, 'patient-journey': english}
    report = []
    for kind, scenes in films.items():
        parts = []
        for scene_id, sentences in scenes.items():
            stem = f'{kind}-{scene_id}'
            source = BASE / 'bilingual/work' / f'{stem}.mp4'
            audio = WORK / f'{stem}.mp3'
            text = ' '.join(sentences)
            (WORK / f'{stem}.txt').write_text(text)
            if not audio.exists():
                await edge_tts.Communicate(text, VOICE, rate='-5%').save(str(audio))
            video_length, speech_length = duration(source), duration(audio)
            if speech_length < 2:
                raise RuntimeError(f'Empty narration: {audio}')
            length = speech_length + PAUSE_SECONDS
            part = WORK / f'{stem}.mp4'
            args = ['-i', source, '-i', audio, '-map', '0:v:0', '-map', '1:a:0']
            if length > video_length:
                args += ['-vf', f'tpad=stop_mode=clone:stop_duration={length-video_length}',
                         '-c:v', 'libx264', '-preset', 'fast', '-crf', '20']
            else:
                # Retain every visual action while removing the long scene holds.
                args += ['-vf', f'setpts={length/video_length}*(PTS-STARTPTS)',
                         '-r', '25', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20']
            args += ['-af', 'loudnorm=I=-17:TP=-2:LRA=11,apad',
                     '-t', length, '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-b:a', '192k', part]
            run(args)
            parts.append(part)
            report.append(dict(film=kind, scene=scene_id, narration=speech_length, duration=length,
                               pause_seconds=PAUSE_SECONDS))
            print(f'Rebuilt {stem}: speech {speech_length:.1f}s / scene {length:.1f}s', flush=True)
        manifest = WORK / f'{kind}-concat.txt'
        manifest.write_text(''.join(f"file '{p}'\n" for p in parts))
        title = 'Capabilities' if kind == 'capabilities' else 'Patient-Journey'
        final = OUT / f'Sahayak-{title}-English-3s-Pauses.mp4'
        run(['-f', 'concat', '-safe', '0', '-i', manifest, '-map', '0:v:0', '-map', '0:a:0',
             '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'aresample=async=1',
             '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0',
             'title=English', '-movflags', '+faststart', final])
        run(['-i', final, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', final.with_suffix('.mp3')])
        run(['-i', final, '-f', 'null', '-'])
        print(f'Verified {final}', flush=True)
    (OUT / 'audio-quality-report.json').write_text(json.dumps(dict(voice=VOICE, rate='-5%', scenes=report), indent=2))

if __name__ == '__main__':
    asyncio.run(main())
