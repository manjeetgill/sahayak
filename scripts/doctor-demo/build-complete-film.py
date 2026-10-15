"""Append a plain-language patient journey to the capabilities film.
Reuses the verified fictional clinic recording; no clinic data is changed.
"""
import argparse, json, pathlib, re, subprocess, textwrap
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE=ROOT/'artifacts/doctor-demo'
OUT=BASE/'complete'
WORK=OUT/'work'
WORK.mkdir(parents=True,exist_ok=True)
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--ffmpeg',required=True)
a=p.parse_args()
FF=a.ffmpeg
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
BOLD='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
TIMELINE={s['id']:s for s in json.loads((BASE/'work/timeline.json').read_text())}
RAW=BASE/'work/doctor-demo-raw.webm'
CAPS=BASE/'capabilities/Sahayak-Capabilities-Demo-Hinglish.mp4'
scenes=[
 ('intro','Now, follow one patient.','From the first message to a caring follow-up.',
  'अब एक पेशेंट की पूरी जर्नी देखते हैं। पहला मैसेज, बुकिंग, क्लिनिक में विज़िट, और घर जाने के बाद फीडबैक। इस उदाहरण में एक काल्पनिक पेशेंट है।'),
 ('hello','A patient starts a conversation','A simple hello gives the patient a clear way to book a visit.',
  'पेशेंट क्लिनिक को हैलो भेजता है। उसे स्वागत के साथ अपॉइंटमेंट बुक करने का विकल्प मिलता है। यहीं से उसकी जर्नी शुरू होती है।'),
 ('booking','The appointment is confirmed','The patient chooses a suitable time. The appointment appears in the clinic calendar.',
  'पेशेंट अपनी विज़िट के बारे में बताता है, अवेलेबल टाइम देखता है और अपनी पसंद का स्लॉट कन्फर्म करता है। अपॉइंटमेंट अब क्लिनिक के कैलेंडर में दिख रहा है।'),
 ('arrival','The patient arrives at the clinic','Check-in and the payment record lead to a queue token for the visit.',
  'क्लिनिक पहुँचकर पेशेंट क्यू आर पेज से चेक-इन करता है। कंसल्टेशन फीस का रिकॉर्ड जुड़ता है, टोकन मिलता है और पेशेंट डॉक्टर की क्यू में आ जाता है।'),
 ('waiting','Waiting time becomes useful','The patient shares what they want to discuss before meeting the doctor.',
  'अपनी बारी का इंतज़ार करते समय पेशेंट बताता है कि डॉक्टर से कौन-सी बात करनी है। यह बात डॉक्टर को विज़िट से पहले दिखाई देती है।'),
 ('consultation','The consultation begins','The doctor calls the patient in and sees the visit information together.',
  'डॉक्टर पेशेंट को अंदर बुलाते हैं। क्यू आगे बढ़ती है, और पेशेंट की जानकारी एक साथ मिलती है। कंसल्टेशन की बातों को व्यवस्थित नोट में रखने से विज़िट का रिकॉर्ड साफ रहता है।'),
 ('approval','The doctor completes the visit note','The doctor reviews the note and patient instructions, then signs the note.',
  'डॉक्टर नोट देखते हैं, पेशेंट के लिए इंस्ट्रक्शंस रिव्यू करते हैं और नोट साइन करते हैं। पेशेंट की आगे की देखभाल का प्लान उसी विज़िट के साथ रहता है।'),
 ('finish','The visit ends. The connection continues.','The completed visit leads to a planned patient check-in and a feedback invitation.',
  'कंसल्टेशन पूरा होने पर विज़िट का रिकॉर्ड अपडेट हो जाता है। पेशेंट के लिए आगे का चेक-इन तय होता है। घर जाने के बाद उससे अनुभव और सुझाव पूछने का अवसर मिलता है।'),
 ('feedback','The patient shares their experience','Feedback stays connected to the visit, including concerns and suggestions.',
  'पेशेंट बताता है कि विज़िट कैसी लगी और क्या बेहतर हो सकता है। इस उदाहरण में उसे अगले स्टेप की और क्लैरिटी चाहिए। उसका जवाब उसी विज़िट के साथ सेव होता है।'),
 ('handoff','The doctor sees what needs attention','The concern becomes a follow-up task, ready for a personal response.',
  'अब डॉक्टर को फॉलो-अप का काम दिखाई देता है। टीम पेशेंट से बात करके उसकी बात समझ सकती है और अगले स्टेप साफ कर सकती है। फीडबैक सिर्फ रेटिंग बनकर नहीं रह जाता।'),
 ('outro','One patient. One connected journey.','Booking → Visit → Feedback → Personal follow-up',
  'पहले मैसेज से लेकर व्यक्तिगत फॉलो-अप तक। सहायक क्लिनिक के कामों को जोड़ता है, ताकि पेशेंट की बात सुनी जाए और ज़रूरी काम सामने रहें।'),
]

def run(cmd): subprocess.run(cmd,check=True)
def textfile(name,text):
 path=WORK/name
 path.write_text(text)
 return path

def draw(path,y,size=30,bold=False,color='white',x='(w-text_w)/2'):
 font=BOLD if bold else FONT
 return f"drawtext=fontfile='{font}':textfile='{path}':expansion=none:fontcolor={color}:fontsize={size}:line_spacing=12:x={x}:y={y}"

parts=[CAPS]
chapters=[]
for id,title,caption,spoken in scenes:
 script=textfile(id+'-voice.txt',spoken)
 audio=WORK/(id+'.aiff')
 run(['say','-v','Lekha','-r','155','-f',str(script),'-o',str(audio)])
 info=subprocess.check_output(['afinfo',str(audio)],text=True)
 match=re.search(r'estimated duration:\s*([\d.]+)',info)
 seconds=float(match.group(1)) if match else 0
 if seconds<1: raise RuntimeError('Empty voiceover: '+id)
 path=WORK/(id+'.mp4')
 captionfile=textfile(id+'-caption.txt','\n'.join(textwrap.wrap(caption,98)))
 titlefile=textfile(id+'-title.txt',title)
 cmd=[FF,'-hide_banner','-y']
 if id in ('intro','outro'):
  duration=seconds+1
  cmd+=['-f','lavfi','-i',f'color=c=0xeff4ef:s=1920x1080:r=25:d={duration}']
  brand=textfile(id+'-brand.txt','SAHAYAK')
  small=textfile(id+'-small.txt','A COMPLETE PATIENT JOURNEY')
  filters=[draw(brand,85,40,True,'0x176b50','110'),draw(small,270,21,True,'0x587463','110'),draw(titlefile,345,72,True,'0x153e30','110'),draw(captionfile,520,32,False,'0x587463','110')]
 else:
  scene=TIMELINE[id]
  duration=max(scene['duration'],seconds+1)
  cmd+=['-ss',str(scene['start']),'-t',str(scene['duration']),'-i',str(RAW)]
  # Keep the actual patient and clinic views. Replace the old narration captions
  # and the one-line explanatory strip with the new plain-language story.
  label=textfile(id+'-label.txt',title)
  filters=['setpts=PTS-STARTPTS',f'tpad=stop_mode=clone:stop_duration={max(0,duration-scene["duration"])+0.2}',
   'drawbox=x=150:y=285:w=1620:h=92:color=0xeff4ef:t=fill',draw(label,321,30,True,'0x153e30','160'),
   'drawbox=x=0:y=885:w=1920:h=195:color=0xeff4ef:t=fill',
   'drawbox=x=110:y=950:w=1700:h=110:color=0x164735:t=fill',draw(captionfile,973,30)]
 cmd+=['-i',str(audio),'-vf',','.join(filters),'-af',f'loudnorm=I=-16:TP=-2:LRA=11,apad,atrim=duration={duration}',
  '-map','0:v','-map','1:a','-t',str(duration),'-r','25','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',
  '-c:a','aac','-ar','48000','-ac','1','-b:a','160k','-movflags','+faststart',str(path)]
 run(cmd)
 parts.append(path)
 chapters.append({'id':id,'title':title,'duration':duration})
 print('Finished scene:',id,round(duration,1),flush=True)
manifest=WORK/'concat.txt'
manifest.write_text('\n'.join("file '"+str(path)+"'" for path in parts)+'\n')
final=OUT/'Sahayak-Capabilities-and-Patient-Journey-Hinglish.mp4'
run([FF,'-hide_banner','-y','-f','concat','-safe','0','-i',str(manifest),'-c','copy','-movflags','+faststart',str(final)])
(WORK/'journey-chapters.json').write_text(json.dumps(chapters,indent=2))
print('COMPLETE:',final,flush=True)
