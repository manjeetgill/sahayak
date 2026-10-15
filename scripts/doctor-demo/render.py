"""Combine the recorded fictional workflow and locally generated Hinglish narration."""
import argparse
import json
import pathlib
import shutil
import subprocess
import os

ROOT = pathlib.Path(__file__).resolve().parents[2]
VARIANT = os.environ.get('DEMO_AUDIENCE', 'doctor')
if VARIANT not in ('doctor', 'owner', 'workflow'):
    raise ValueError('Unknown DEMO_AUDIENCE')
OUTPUT = ROOT / f'artifacts/{VARIANT}-demo'
WORK = OUTPUT / 'work'


def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg'))
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error('Pass --ffmpeg /absolute/path/to/ffmpeg')
    scenes = json.loads((WORK / 'timeline.json').read_text())
    start = scenes[0]['start']
    duration = scenes[-1]['start'] + scenes[-1]['duration'] - start
    prefix = f'Sahayak-{VARIANT.title()}-Demo'
    video = OUTPUT / f'{prefix}-Hinglish.mp4'
    command = [args.ffmpeg, '-hide_banner', '-y', '-ss', str(start),
               '-i', str(WORK / 'doctor-demo-raw.webm')]
    filters = ['[0:v]setpts=PTS-STARTPTS[v]']
    subtitles = []
    chapters = [f'# Sahayak {VARIANT} demo — Hinglish', '',
                'Fictional patient data; actual saved workflow in an isolated test clinic.',
                'Synthetic Hinglish narration with English captions.', '',
                'No real WhatsApp messages, phone calls or payments are made in this recording.', '',
                '## Chapters', '']
    for index, scene in enumerate(scenes, 1):
        audio = WORK / (scene['id'] + '.aiff')
        if not audio.is_file():
            raise FileNotFoundError(audio)
        command += ['-i', str(audio)]
        offset = scene['start'] - start
        delay = round(offset * 1000)
        filters.append(f'[{index}:a]aresample=48000,adelay={delay}:all=1[a{index}]')
        chapters.append(f"- {int(offset)//60:02}:{int(offset)%60:02} — {scene['title'].replace(chr(10), ' ')}")
        words = [len(line.split()) for line in scene['narration']]
        elapsed = offset
        for line, count in zip(scene['narration'], words):
            end = elapsed + scene['audioSeconds'] * count / sum(words)
            subtitles.append(f'{len(subtitles)+1}\n{timestamp(elapsed)} --> {timestamp(end)}\n{line}\n')
            elapsed = end
    inputs = ''.join(f'[a{i}]' for i in range(1, len(scenes)+1))
    filters.append(f'{inputs}amix=inputs={len(scenes)}:duration=longest:normalize=0,'
                   f'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,'
                   f'alimiter=limit=0.794:level=false:latency=true,apad,'
                   f'atrim=duration={duration}[audio]')
    command += ['-filter_complex', ';'.join(filters), '-map', '[v]', '-map', '[audio]',
                '-t', str(duration), '-r', '25', '-c:v', 'libx264', '-preset', 'medium',
                '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
                '-ar', '48000', '-movflags', '+faststart',
                '-metadata', 'title=Sahayak — A connected patient journey',
                '-metadata:s:a:0', 'language=hin', str(video)]
    subprocess.run(command, check=True)
    (OUTPUT / f'{prefix}-English.srt').write_text('\n'.join(subtitles))
    (OUTPUT / 'README.md').write_text('\n'.join(chapters) + '\n')
    print(f'Rendered {video} ({duration:.1f} seconds)')


if __name__ == '__main__':
    main()
