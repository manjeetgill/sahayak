"""Render the original narration using an installed macOS voice."""
import json, pathlib, subprocess, re, os
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'artifacts/doctor-demo/work'
out.mkdir(parents=True,exist_ok=True)
scenes=json.loads((root/'scripts/doctor-demo/scenes.json').read_text())
voice=os.environ.get('DEMO_VOICE','Lekha')
for scene in scenes:
 text=' '.join(scene.get('spoken',scene['narration']))
 source=out/(scene['id']+'.txt');source.write_text(text)
 audio=out/(scene['id']+'.aiff')
 subprocess.run(['say','-v',voice,'-r','155','-f',str(source),'-o',str(audio)],check=True)
 info=subprocess.check_output(['afinfo',str(audio)],text=True)
 match=re.search(r'estimated duration:\s*([\d.]+)',info)
 seconds=float(match.group(1)) if match else 0
 if seconds<1: raise RuntimeError('Narration was not rendered: '+scene['id'])
 scene['audioSeconds']=seconds
 scene['audioFile']=str(audio)
 print(scene['id'],round(seconds,2),flush=True)
(out/'scenes-audio.json').write_text(json.dumps(scenes,indent=2))
print('Narration ready:',round(sum(s['audioSeconds'] for s in scenes),1),'seconds')
