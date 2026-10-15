"""Create a portable language-selecting player for the two Sahayak films."""
import json,pathlib,re,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/doctor-demo/bilingual'
def seconds(t):
 h,m,s=t.replace(',','.').split(':');return int(h)*3600+int(m)*60+float(s)
cues={}
for kind in ('capabilities','patient-journey'):
 cues[kind]={}
 for lang in ('en','hi'):
  entries=[]
  for block in (OUT/f'{kind}-{lang}.srt').read_text().strip().split('\n\n'):
   lines=block.splitlines();start,end=lines[1].split(' --> ')
   entries.append([seconds(start),seconds(end),'\n'.join(lines[2:])])
  cues[kind][lang]=entries
html='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sahayak videos · English & Hinglish</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef4ef;color:#153e30;font:17px/1.5 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:28px 24px 60px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}header strong{font-size:29px}header span{color:#5b7666}h1{font-size:36px;line-height:1.2;margin:32px 0 12px}p{color:#587463}nav{display:flex;gap:12px;margin:26px 0}button,select,a.download{border:1px solid #c6d9cd;border-radius:10px;padding:12px 17px;font:inherit;background:white;color:#153e30}button{cursor:pointer;font-weight:650}button[aria-selected=true]{background:#176b50;color:white}section{background:white;border:1px solid #d4e2d8;border-radius:18px;padding:22px;box-shadow:0 14px 45px #163d3008}section[hidden]{display:none}h2{margin:0;font-size:25px}.tools{display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin:20px 0}label{display:flex;align-items:center;gap:10px}video{display:block;width:100%;border-radius:12px;background:#153e30;aspect-ratio:16/9}video::cue{font-family:system-ui,sans-serif;font-size:24px;background:#153e30e8;color:white}.downloads{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}a{color:#176b50}.note{font-size:14px;margin-bottom:0}.status{min-height:24px;font-size:14px;color:#587463}@media(max-width:650px){header{align-items:flex-start;flex-direction:column}h1{font-size:28px}section{padding:14px}.tools{gap:14px}nav{flex-direction:column}}
</style></head><body><main><header><strong>✚ Sahayak</strong><span>English · Hinglish</span></header><h1>Get to know Sahayak.</h1><p>Two videos, at a relaxed pace. Choose a video and the language you prefer.</p><nav role="tablist" aria-label="Choose a video"><button role="tab" id="tab-capabilities" aria-selected="true" aria-controls="capabilities">1. Capabilities</button><button role="tab" id="tab-patient-journey" aria-selected="false" aria-controls="patient-journey">2. Complete patient journey</button></nav>'''
for kind,title,description in [('capabilities','What Sahayak can do','See how Sahayak’s assistants help doctors, patients and clinic teams.'),('patient-journey','One patient’s complete journey','Booking, arrival, consultation, feedback and personal follow-up — together.')]:
 html+=f'''<section id="{kind}" role="tabpanel" aria-labelledby="tab-{kind}" {'hidden' if kind!='capabilities' else ''}><h2>{title}</h2><p>{description}</p><div class="tools"><label>Language <select class="language" aria-label="Narration language"><option value="en">English</option><option value="hi">Hinglish</option></select></label><label><input class="captions" type="checkbox" checked>Subtitles</label><label>Speed <select class="speed" aria-label="Playback speed"><option value="0.85">Even slower</option><option value="1" selected>Relaxed pace</option><option value="1.15">A little faster</option></select></label></div><video controls preload="metadata" playsinline src="{kind}-en.mp4" aria-label="{title}"></video><div class="status" aria-live="polite"></div><div class="downloads"><a class="download selected-download" href="{kind}-en.mp4" download>Download English video</a><a class="download" href="Sahayak-{kind}-English-Hinglish.mp4" download>Download both languages</a></div><p class="note">Screen labels are in English. Language changes the narration and subtitles.</p></section>'''
html+='''</main><script>
const subtitles=SUBTITLE_DATA;
for(const panel of document.querySelectorAll('section')){
 const video=panel.querySelector('video'),language=panel.querySelector('.language'),captions=panel.querySelector('.captions'),speed=panel.querySelector('.speed'),status=panel.querySelector('.status');let change=0;
 const tracks={};
 for(const lang of ['en','hi']){const track=video.addTextTrack('subtitles',lang==='en'?'English':'Hinglish',lang);for(const [a,b,text] of subtitles[panel.id][lang])track.addCue(new VTTCue(a,b,text));tracks[lang]=track;}
 const showCaptions=()=>{for(const lang of ['en','hi'])tracks[lang].mode=captions.checked&&language.value===lang?'showing':'disabled';};showCaptions();
 captions.addEventListener('change',showCaptions);
 speed.addEventListener('change',()=>video.playbackRate=Number(speed.value));
 language.addEventListener('change',()=>{
  const version=++change,time=video.currentTime||0,resume=!video.paused;video.pause();status.textContent='Changing language…';
  video.src=panel.id+'-'+language.value+'.mp4';video.load();showCaptions();
  const link=panel.querySelector('.selected-download');link.href=panel.id+'-'+language.value+'.mp4';link.textContent='Download '+(language.value==='en'?'English':'Hinglish')+' video';
  video.addEventListener('loadedmetadata',async()=>{if(version!==change)return;video.currentTime=Math.min(time,Math.max(0,video.duration-.1));video.playbackRate=Number(speed.value);status.textContent='';if(resume)try{await video.play();}catch{status.textContent='Press Play to continue.';}},{once:true});
 });
 video.addEventListener('error',()=>status.textContent='Keep this player and its video files in the same folder, then open the player again.');
}
for(const tab of document.querySelectorAll('[role=tab]'))tab.addEventListener('click',()=>{for(const panel of document.querySelectorAll('section')){panel.querySelector('video').pause();panel.hidden=panel.id!==tab.getAttribute('aria-controls');}for(const button of document.querySelectorAll('[role=tab]'))button.setAttribute('aria-selected',String(button===tab));});
</script></body></html>'''.replace('SUBTITLE_DATA',json.dumps(cues,ensure_ascii=False).replace('</','<\\/'))
(OUT/'index.html').write_text(html)
with zipfile.ZipFile(OUT/'Sahayak-Videos-English-Hinglish.zip','w',compression=zipfile.ZIP_STORED) as z:
 z.write(OUT/'index.html','Sahayak-videos/index.html')
 for kind in ('capabilities','patient-journey'):
  for name in (f'{kind}-en.mp4',f'{kind}-hi.mp4',f'Sahayak-{kind}-English-Hinglish.mp4'):
   z.write(OUT/name,'Sahayak-videos/'+name)
print(OUT/'index.html')
