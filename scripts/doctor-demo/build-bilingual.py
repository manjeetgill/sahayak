"""Build two slower films, each with English/Hinglish audio and subtitles, plus a local player."""
import argparse,ast,json,pathlib,re,subprocess,textwrap
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE=ROOT/'artifacts/doctor-demo'
OUT=BASE/'bilingual'
WORK=OUT/'work'
WORK.mkdir(parents=True,exist_ok=True)
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--ffmpeg',required=True);args=p.parse_args();FF=args.ffmpeg

def run(cmd): subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def timecode(s,vtt=False):
 ms=round(s*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
 return f'{h:02}:{m:02}:{s:02}{"." if vtt else ","}{ms:03}'
def duration(path):
 r=subprocess.run([FF,'-hide_banner','-i',str(path)],capture_output=True,text=True)
 m=re.search(r'Duration: (\d+):(\d+):([\d.]+)',r.stderr)
 if not m:raise RuntimeError('Cannot read duration: '+str(path))
 return int(m[1])*3600+int(m[2])*60+float(m[3])
def speech(kind,id,lang,text):
 f=WORK/f'{kind}-{id}-{lang}.txt';f.write_text(text)
 audio=f.with_suffix('.aiff')
 run(['say','-v','Rishi' if lang=='en' else 'Lekha','-r','130','-f',str(f),'-o',str(audio)])
 info=subprocess.check_output(['afinfo',str(audio)],text=True)
 m=re.search(r'estimated duration:\s*([\d.]+)',info)
 seconds=float(m[1]) if m else 0
 if seconds<1:raise RuntimeError('Empty narration: '+str(audio))
 return audio,seconds

caps=json.loads((ROOT/'scripts/doctor-demo/capabilities-scenes.json').read_text())
ct={s['id']:s for s in json.loads((BASE/'capabilities/work/timeline.json').read_text())}
for s in caps:
 s.update(en=s['narration'],hi=s['spoken'],source=BASE/'capabilities/work/doctor-demo-raw.webm',start=ct[s['id']]['start'],baseDuration=ct[s['id']]['duration'])
source=ast.parse((ROOT/'scripts/doctor-demo/build-complete-film.py').read_text())
flow=next(ast.literal_eval(n.value) for n in source.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='scenes' for t in n.targets))
english={
'intro':['Now, let us follow one patient from the first message to booking, consultation and feedback.','This example follows a fictional patient through a complete clinic visit.'],
'hello':['The patient sends a simple hello to the clinic and receives a welcome with an option to book an appointment.','The patient now has a clear way to begin.'],
'booking':['The patient shares the type of visit, looks at available times and confirms a suitable slot.','The appointment is now visible in the clinic calendar.'],
'arrival':['On arrival, the patient checks in using the patient QR page.','The consultation payment is recorded, a token is issued and the patient joins the doctor’s queue.'],
'waiting':['While waiting, the patient shares something they want to discuss with the doctor.','The doctor can see this concern before the visit begins.'],
'consultation':['The doctor calls the patient in. The queue moves forward, and the patient’s information is available together.','An organised consultation note keeps the visit record clear.'],
'approval':['The doctor reviews the note and the patient’s instructions, then signs the note.','The next steps for the patient’s care remain connected to this visit.'],
'finish':['When the consultation is complete, the visit record is updated and a patient check-in is planned.','After going home, the patient has an opportunity to share their experience and suggestions.'],
'feedback':['The patient describes their experience and what could be improved.','In this example, the patient wants clearer next steps. Their feedback is saved with the same visit.'],
'handoff':['The concern now appears as a follow-up task for the doctor.','The clinic team can speak with the patient, understand their concern and clarify the next steps. Feedback becomes an opportunity for personal attention.'],
'outro':['From the first message to personal follow-up, Sahayak brings the clinic’s work together.','The patient’s voice stays visible, and the next action is clear.']}
flows=[dict(id=id,title=title,en=english[id],hi=[spoken],source=BASE/f'complete/work/{id}.mp4',start=0,baseDuration=duration(BASE/f'complete/work/{id}.mp4')) for id,title,caption,spoken in flow]
hinglish=json.loads((ROOT/'scripts/doctor-demo/hinglish-captions.json').read_text())
summary={}
for kind,scenes in [('capabilities',caps),('patient-journey',flows)]:
 parts=[];cues={'en':[],'hi':[]};offset=0;chapters=[]
 for scene in scenes:
  id=scene['id'];audio={lang:speech(kind,id,lang,' '.join(scene[lang])) for lang in ('en','hi')}
  length=max(scene['baseDuration']*1.20,*[a[1]+2 for a in audio.values()])
  part=WORK/f'{kind}-{id}.mp4'
  vf='setpts=1.20*(PTS-STARTPTS),tpad=stop_mode=clone:stop_duration=60,drawbox=x=0:y=933:w=1920:h=147:color=0xeff4ef:t=fill'
  cmd=[FF,'-y','-ss',str(scene['start']),'-t',str(scene['baseDuration']),'-i',str(scene['source']),'-i',str(audio['en'][0]),'-i',str(audio['hi'][0]),
   '-filter_complex',f'[0:v]{vf}[v];[1:a]loudnorm=I=-17:TP=-2:LRA=11,apad,atrim=duration={length}[en];[2:a]loudnorm=I=-17:TP=-2:LRA=11,apad,atrim=duration={length}[hi]',
   '-map','[v]','-map','[en]','-map','[hi]','-t',str(length),'-r','25','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','1','-b:a','160k',str(part)]
  run(cmd);parts.append(part);chapters.append({'title':scene['title'].replace('\n',' '),'start':offset})
  for lang in ('en','hi'):
   # Sentence cues match the narration pace approximately; both editions share the same scene timing.
   lines=hinglish[kind][id] if lang=='hi' else scene[lang];weights=[len(x.split()) for x in lines];elapsed=offset
   for line,w in zip(lines,weights):
    end=elapsed+audio[lang][1]*w/sum(weights)
    cues[lang].append((elapsed,end,line));elapsed=end
  offset+=length
  print('Rendered',kind,id,round(length,1),flush=True)
 manifest=WORK/f'{kind}-concat.txt';manifest.write_text('\n'.join("file '"+str(x)+"'" for x in parts)+'\n')
 joined=WORK/f'{kind}-joined.mp4';run([FF,'-y','-f','concat','-safe','0','-i',str(manifest),'-map','0','-c','copy',str(joined)])
 for lang in ('en','hi'):
  (OUT/f'{kind}-{lang}.srt').write_text('\n'.join(f'{i+1}\n{timecode(start)} --> {timecode(end)}\n{text}\n' for i,(start,end,text) in enumerate(cues[lang])))
  (OUT/f'{kind}-{lang}.vtt').write_text('WEBVTT\n\n'+'\n'.join(f'{timecode(start,True)} --> {timecode(end,True)}\n{text}\n' for start,end,text in cues[lang]))
 final=OUT/f'Sahayak-{kind}-English-Hinglish.mp4'
 run([FF,'-y','-i',str(joined),'-i',str(OUT/f'{kind}-en.srt'),'-i',str(OUT/f'{kind}-hi.srt'),'-map','0:v','-map','0:a:0','-map','0:a:1','-map','1','-map','2','-c:v','copy','-c:a','copy','-c:s','mov_text','-metadata:s:a:0','language=eng','-metadata:s:a:0','title=English','-metadata:s:a:1','language=hin','-metadata:s:a:1','title=Hinglish','-metadata:s:s:0','language=eng','-metadata:s:s:1','language=hin','-metadata:s:s:1','title=Hinglish','-disposition:a:0','default','-disposition:a:1','0','-movflags','+faststart',str(final)])
 for i,lang in enumerate(('en','hi')):
  run([FF,'-y','-i',str(final),'-map','0:v','-map',f'0:a:{i}','-c','copy','-movflags','+faststart',str(OUT/f'{kind}-{lang}.mp4')])
 summary[kind]={'duration':offset,'chapters':chapters}
(OUT/'chapters.json').write_text(json.dumps(summary,indent=2))
print('COMPLETE',OUT,flush=True)
