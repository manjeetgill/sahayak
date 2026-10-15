"""Render two app recordings with English speech and downloadable captions."""
import asyncio,json,pathlib,subprocess,re,shutil
import edge_tts,imageio_ffmpeg
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/english-live-demo';W=OUT/'work';FF=imageio_ffmpeg.get_ffmpeg_exe()
def run(args):subprocess.run([FF,'-hide_banner','-loglevel','error','-y',*map(str,args)],check=True)
def duration(p):
 s=subprocess.run([FF,'-i',str(p)],capture_output=True,text=True).stderr
 m=re.search(r'Duration: (\d+):(\d+):([\d.]+)',s)
 if not m:raise RuntimeError('No media duration '+str(p))
 return int(m[1])*3600+int(m[2])*60+float(m[3])
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
async def main():
 films=json.loads((W/'films.json').read_text());report={}
 for name,scenes in films.items():
  parts=[];captions=['WEBVTT',''];elapsed=0;chapters=[]
  for i,s in enumerate(scenes):
   audio=W/f'{name}-{i}.mp3'
   transcript=audio.with_suffix('.txt')
   if not audio.exists() or not transcript.exists() or transcript.read_text()!=s['text']:
    await edge_tts.Communicate(s['text'],'en-GB-SoniaNeural',rate='-3%').save(str(audio))
    transcript.write_text(s['text'])
   length=max(duration(audio)+1.2,s['duration']);part=W/f'{name}-{i}.mp4'
   run(['-ss',s['start'],'-t',s['duration'],'-i',W/f'{name}.webm','-i',audio,'-map','0:v:0','-map','1:a:0','-vf',f'tpad=stop_mode=clone:stop_duration={length},scale=1440:1000,setsar=1','-af','loudnorm=I=-17:TP=-2:LRA=11,apad','-t',length,'-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-r','25','-c:a','aac','-b:a','160k',part])
   parts.append(part);chapters.append({'title':s['title'],'seconds':round(elapsed,1)})
   sentences=re.split(r'(?<=[.!?])\s+',s['text']);words=sum(len(x.split()) for x in sentences);offset=elapsed
   for sentence in sentences:
    end=offset+(length-1.2)*len(sentence.split())/words
    captions.extend([f'{stamp(offset)} --> {stamp(end)}',sentence,'']);offset=end
   elapsed+=length;print(name,i+1,len(scenes),flush=True)
  manifest=W/f'{name}-concat.txt';manifest.write_text(''.join(f"file '{p}'\n" for p in parts))
  final=OUT/f'Sahayak-{name}-English.mp4'
  run(['-f','concat','-safe','0','-i',manifest,'-c','copy','-movflags','+faststart',final])
  run(['-i',final,'-f','null','-'])
  final.with_suffix('.vtt').write_text('\n'.join(captions));report[name]={'duration':duration(final),'chapters':chapters,'file':final.name}
  print('VERIFIED',final,duration(final),flush=True)
 public=ROOT/'apps/web/public/demo-videos';public.mkdir(parents=True,exist_ok=True)
 for file in OUT.glob('Sahayak-*'):
  if file.suffix in ['.mp4','.vtt']:shutil.copy2(file,public/file.name)
 (OUT/'report.json').write_text(json.dumps(report,indent=2));(public/'report.json').write_text(json.dumps(report,indent=2))
asyncio.run(main())
