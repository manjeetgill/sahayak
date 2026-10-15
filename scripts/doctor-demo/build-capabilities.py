"""Create the capabilities-only Hinglish film without touching clinic data."""
import importlib.util
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'artifacts/doctor-demo/capabilities'
WORK = OUTPUT / 'work'
WORK.mkdir(parents=True, exist_ok=True)
scenes = json.loads((ROOT/'scripts/doctor-demo/capabilities-scenes.json').read_text())
for scene in scenes:
    source = WORK/(scene['id']+'.txt')
    source.write_text(' '.join(scene['spoken']))
    audio = WORK/(scene['id']+'.aiff')
    subprocess.run(['say','-v','Lekha','-r','155','-f',str(source),'-o',str(audio)],check=True)
    info = subprocess.check_output(['afinfo',str(audio)],text=True)
    match = re.search(r'estimated duration:\s*([\d.]+)',info)
    seconds = float(match.group(1)) if match else 0
    if seconds < 1: raise RuntimeError('Empty narration: '+scene['id'])
    scene.update(audioSeconds=seconds,audioFile=str(audio))
    print('Narrated',scene['id'],round(seconds,1),flush=True)
(WORK/'scenes-audio.json').write_text(json.dumps(scenes,ensure_ascii=False,indent=2))
subprocess.run(['node','scripts/doctor-demo/record-capabilities.mjs'],cwd=ROOT,check=True)
spec = importlib.util.spec_from_file_location('film_renderer',ROOT/'scripts/doctor-demo/render.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
renderer.OUTPUT = OUTPUT
renderer.WORK = WORK
renderer.VARIANT = 'capabilities'
renderer.main()
# Replace the reusable renderer's walkthrough description with this film's actual scope.
chapters = ['# Sahayak capabilities — Hinglish','',
            'Capabilities overview with original illustrative cards and synthetic Hinglish narration.',
            'No live patient workflow is executed or patient data accessed in this film.','', '## Chapters','']
timeline=json.loads((WORK/'timeline.json').read_text())
for scene in timeline:
    offset=int(scene['start']-timeline[0]['start'])
    chapters.append(f"- {offset//60:02}:{offset%60:02} — {scene['title'].replace(chr(10),' ')}")
(OUTPUT/'README.md').write_text('\n'.join(chapters)+'\n')
