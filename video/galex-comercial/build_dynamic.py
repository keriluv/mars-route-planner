"""Genera V2 con navegación real y cambios de función cada menos de 8 segundos."""
from pathlib import Path
from html import escape
import json

ROOT = Path(__file__).resolve().parent
SHOTS = [
    ('planet',8,'Cada paso importa','Planeta 3D · gira, navega y acércate a Marte'),
    ('relief',8,'El terreno cobra dimensión','Relieve 3D · órbita y perspectiva del paisaje'),
    ('map',8,'Muévete por el mapa','Desplazamiento, zoom y mapas base'),
    ('layers',8,'Una superficie. Muchas lecturas','Capas, curvas de nivel, pendiente y térmico relativo'),
    ('regions',7,'Dos regiones para explorar','Gale y Jezero · vistas regionales'),
    ('minerals',8,'Encuentra señales de ciencia','Búsqueda de minerales, fichas y referencias de instrumentos'),
    ('objectives',6,'Elige tu siguiente objetivo','Objetivos, filtros y referencias sobre el mapa'),
    ('planning',8,'Diseña tu recorrido','Paradas y perfiles Segura, Rápida y Científica'),
    ('eva',8,'Acompaña cada etapa','Explorador, elevación, reloj, recursos y avance simulado'),
    ('conditions',8,'Pon los datos en contexto','Condiciones atmosféricas, terreno y modelo'),
    ('suit',6,'Observa el esfuerzo de la EVA','Fisiología y recursos · modelo experimental'),
    ('weather',6,'Observa. Evalúa. Decide','Tormenta hipotética, alertas y pausa'),
    ('missions',7,'Una misión. Nuevos objetivos','Misiones principales y secundarias'),
    ('records',8,'Conserva lo que descubres','Hallazgos, notas y estado de los reportes'),
    ('log',7,'Cada observación cuenta','Bitácora, asistente y comunicaciones simuladas'),
    ('rovers',7,'Conecta con sus recorridos','Curiosity y Perseverance · comparación exploratoria'),
    ('controls',7,'Tu espacio de exploración','Tema, idioma, ayuda y accesibilidad'),
]
hosts=[]
schedule=[]
start=0.0
for index,(sid,duration,title,sub) in enumerate(SHOTS):
    reveal=['inset(0 100% 0 0)','circle(0% at 70% 48%)','inset(100% 0 0 0)'][index%3]
    end='circle(150% at 70% 48%)' if index%3==1 else 'inset(0% 0% 0% 0%)'
    entry='' if index==0 else f"tl.fromTo('#{sid}-stage',{{clipPath:'{reveal}'}},{{clipPath:'{end}',duration:0.6,ease:'power3.inOut'}},0);"
    focus=sid in ('planning','suit','records','log','conditions','rovers')
    scale=1.25 if focus else 1.06
    origin='20% 42%' if sid in ('planning','suit') else '58% 48%'
    x=85 if sid=='planning' else -40 if sid in ('log','records') else 0
    html=f'''<template><style>
#root{{position:absolute;inset:0;font-family:Inter;color:#fff;overflow:hidden}}
.stage{{position:absolute;inset:0;background:#080808;overflow:hidden}}
.screen{{position:absolute;inset:0;transform-origin:{origin}}}
video{{position:absolute;inset:0;width:1920px;height:1080px;object-fit:cover}}
.copy{{position:absolute;left:112px;bottom:112px;max-width:1560px;overflow:hidden}}
.words{{background:rgba(5,5,5,0.94);padding:24px 34px 26px;border-left:6px solid #fc3d21}}
h1{{font-size:64px;line-height:1.1;letter-spacing:-2px;margin:0;font-weight:700}}
p{{font-size:30px;line-height:1.35;color:#e5e5e5;margin:12px 0 0}}
.chapter{{position:absolute;top:100px;right:112px;font-size:30px;font-weight:700;letter-spacing:2px;background:#080808;padding:10px 18px}}
.progress{{position:absolute;bottom:0;left:0;width:1920px;height:5px;background:#fc3d21;transform-origin:left center}}
</style><div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080"><div id="{sid}-stage" class="stage">
<div id="{sid}-screen" class="screen" data-layout-allow-overflow><video id="{sid}-footage" class="clip" src="assets/v2-{sid}.mp4" muted playsinline data-start="0" data-duration="{duration}" data-track-index="0"></video></div>
<div id="{sid}-chapter" class="chapter">{index+1:02d} / GALEX</div>
<div id="{sid}-copy" class="copy clip" data-start="0.25" data-duration="3.8" data-track-index="1"><div id="{sid}-words" class="words"><h1>{escape(title)}</h1><p>{escape(sub)}</p></div></div>
<div id="{sid}-progress" class="progress" data-layout-ignore></div></div></div><script>
const tl=gsap.timeline({{paused:true}});
{entry}
tl.fromTo('#{sid}-words',{{clipPath:'inset(0 100% 0 0)'}},{{clipPath:'inset(0 0% 0 0)',duration:0.55,ease:'power4.out'}},0.25);
tl.to('#{sid}-words',{{clipPath:'inset(0 0 100% 0)',duration:0.3,ease:'power2.in'}},3.7);
tl.fromTo('#{sid}-screen',{{scale:1,x:0}},{{scale:{scale},x:{x},duration:1.15,ease:'power2.inOut'}},0.8);
tl.to('#{sid}-screen',{{scale:1.02,x:0,duration:1.2,ease:'power2.inOut'}},{duration-1.6});
tl.fromTo('#{sid}-progress',{{scaleX:0}},{{scaleX:1,duration:{duration},ease:'none'}},0);
window.__timelines['{sid}']=tl;</script></template>'''
    (ROOT/'compositions'/f'{sid}.html').write_text(html)
    hosts.append(f'<div id="{sid}" class="clip" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{start:.2f}" data-duration="{duration}" data-track-index="{1+index%2}" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index:{index+1}"></div>')
    schedule.append({'scene':sid,'start':round(start,2),'duration':duration,'title':title,'features':sub})
    start+=duration-0.6
outro=(ROOT/'compositions/outro.html').read_text().replace('left:1220px;top:265px','left:1227px;top:259px')
(ROOT/'compositions/outro.html').write_text(outro)
hosts.append(f'<div id="outro" class="clip" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="{start:.2f}" data-duration="5" data-track-index="{1+len(SHOTS)%2}" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index:30"></div>')
total=round(start+5,2)
variables=json.dumps([{'id':'tagline','type':'string','label':'Cierre','default':'Traza tu próxima exploración'}],ensure_ascii=False)
(ROOT/'index.html').write_text(f'''<!doctype html><html lang="es" data-composition-variables='{variables}'><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080"><script src="assets/gsap.min.js"></script><style>*{{box-sizing:border-box}}html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}}#root{{position:relative;width:1920px;height:1080px}}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="{total}" data-width="1920" data-height="1080" data-fps="30">'''+''.join(hosts)+'''</div><script>window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});</script></body></html>''')
(ROOT/'coverage.json').write_text(json.dumps({'version':2,'duration':total,'fps':30,'transition_overlap':0.6,'scenes':schedule},ensure_ascii=False,indent=2)+'\n')
print(f'{len(SHOTS)+1} escenas / {total} segundos / cambio de función cada 5,4–7,4 segundos')
