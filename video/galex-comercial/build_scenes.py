"""Genera las composiciones editables del comercial elegido."""
from pathlib import Path
from html import escape
import json

ROOT = Path(__file__).resolve().parent
shots = [
    ('opening', 0, 6, 'globe', 'Cada paso importa', 'GALEX / EXPLORACIÓN MARCIANA', 'Una perspectiva para explorar, planificar y simular', 'dark'),
    ('explore', 6, 8, 'globe', 'Explora desde otra perspectiva', '01 / DEL PLANETA AL TERRENO', 'Mapa 2D · Relieve 3D · Planeta 3D', 'light'),
    ('science', 14, 9, 'science', 'Conecta terreno y evidencia', '02 / CAPAS Y CIENCIA', 'Relieve, minerales y objetivos en una misma vista', 'light'),
    ('rovers', 23, 6, 'rovers', 'Sigue las huellas de la exploración', '03 / CURIOSITY + PERSEVERANCE', 'Comparaciones exploratorias · no certifican seguridad EVA', 'dark'),
    ('planning', 29, 11, 'planning', 'Diseña tu recorrido', '04 / RUTAS PROPIAS', 'Perfiles de ruta y ajustes de grilla · ejemplo corto en Gale', 'light'),
    ('eva', 40, 12, 'eva', 'Simula cada etapa', '05 / EXPLORACIÓN HUMANA EVA', 'Progreso, relieve y recursos · modelo demostrativo', 'light'),
    ('weather', 52, 7, 'weather', 'Observa. Evalúa. Decide', '06 / ESCENARIOS AMBIENTALES', 'Tormenta hipotética · alertas y pausa de simulación', 'dark'),
    ('records', 59, 8, 'records', 'Conserva lo que descubres', '07 / HALLAZGOS Y BITÁCORA', 'Registra observaciones y consulta tus reportes', 'light'),
    ('payoff', 67, 4, 'maps', 'Explora · Planifica · Simula', 'GALEX / TU MISIÓN, EN CONTEXTO', 'Del mapa al recorrido. Del recorrido al descubrimiento.', 'dark'),
]
hosts = []
for sid, start, duration, media, title, label, sub, theme in shots:
    hosts.append(f'<div id="{sid}" class="clip" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{start}" data-duration="{duration}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
    fg, bg = ('#ffffff', '#080808') if theme == 'dark' else ('#151a22', '#ffffff')
    footage = f'<video id="{sid}-footage" class="clip" src="assets/{media}.mp4" muted playsinline data-start="0" data-duration="{duration}" data-track-index="0"></video>'
    if sid == 'opening':
        footage = '<img id="opening-footage" class="clip" src="assets/relief-still.png" data-start="0" data-duration="6" data-track-index="0" alt="Vista real del relieve 3D de GaleX">'
    if sid == 'explore':
        footage += '<img id="explore-relief" class="clip" src="assets/relief-still.png" data-start="4" data-duration="4" data-track-index="1" alt="Relieve 3D de GaleX">'
    if sid in ('planning', 'eva'):
        footage += f'<img id="{sid}-detail" class="clip" src="assets/{sid}-still.png" data-start="3" data-duration="{duration-3}" data-track-index="1" alt="Detalle real de los recursos y la ruta en GaleX">'
    # La cámara sigue un único contenedor: adaptación del principio ui-focus-zoom.
    text = f'''<template>
<style>
#root {{position:absolute;inset:0;background:{bg};color:{fg};font-family:Inter;overflow:hidden}}
.frame {{position:absolute;left:0;top:0;width:1920px;height:810px;overflow:hidden;background:#141414}}
.camera {{position:absolute;inset:0;transform-origin:60% 45%}}
video,img {{width:1440px;height:810px;object-fit:contain;position:absolute;top:0;left:240px}}
.copy {{position:absolute;left:112px;top:846px;right:112px}}
.label {{font-size:30px;letter-spacing:3px;color:{'#ff765f' if theme == 'dark' else '#b52c1a'};font-weight:700;margin-bottom:10px}}
h1 {{font-size:{66 if len(title)>33 else 76}px;letter-spacing:-3px;line-height:1.1;margin:0;font-weight:700}}
.sub {{font-size:30px;margin:14px 0 0;color:{'#d9d9d9' if theme == 'dark' else '#434b58'}}}
.rail {{position:absolute;left:0;top:810px;height:6px;width:1920px;background:#fc3d21;transform-origin:left center}}
</style>
<div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080">
 <div class="frame" data-layout-allow-overflow><div class="camera" id="{sid}-camera">
 {footage}</div></div>
 <div class="rail" id="{sid}-rail" data-layout-ignore></div>
 <div class="copy" id="{sid}-copy"><div class="label">{escape(label)}</div><h1>{escape(title)}</h1><p class="sub">{escape(sub)}</p></div>
</div>
<script>
const tl=gsap.timeline({{paused:true}});
tl.fromTo('#{sid}-camera',{{scale:1.12,x:30}},{{scale:1,x:0,duration:0.65,ease:'power3.out'}},0);
tl.fromTo('#{sid}-copy',{{y:24,opacity:0}},{{y:0,opacity:1,duration:0.45,ease:'power3.out'}},0.12);
tl.fromTo('#{sid}-rail',{{scaleX:0}},{{scaleX:1,duration:0.7,ease:'power3.inOut'}},0);
tl.fromTo('#{sid}-camera',{{scale:1,x:0}},{{scale:{1.9 if sid in ('planning','eva') else 1.18},x:{550 if sid in ('planning','eva') else 0},duration:0.7,ease:'power3.inOut',immediateRender:false}},1.6);
tl.to('#{sid}-camera',{{scale:1,x:0,duration:0.7,ease:'power3.inOut'}},{max(2.5,duration-1.5)});
window.__timelines['{sid}']=tl;
</script></template>'''
    (ROOT / 'compositions' / f'{sid}.html').write_text(text)

hosts.append('<div id="outro" class="clip" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="71" data-duration="5" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
(ROOT / 'index.html').write_text('''<!doctype html><html lang="es" data-composition-variables='[{"id":"tagline","type":"string","label":"Cierre","default":"Traza tu próxima exploración"}]'><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080"><script src="assets/gsap.min.js"></script><style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}#root{position:relative;width:1920px;height:1080px}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="76" data-width="1920" data-height="1080" data-fps="30">'''+''.join(hosts)+'''</div><script>window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});</script></body></html>''')
(ROOT / 'compositions' / 'outro.html').write_text('''<template><style>
#root{position:absolute;inset:0;background:#000;color:#fff;font-family:Inter;overflow:hidden}
.mark-window{position:absolute;left:410px;top:80px;width:1100px;height:735px;overflow:hidden}
.mark{width:1100px;height:auto;display:block}
.tagline{position:absolute;top:820px;left:192px;right:192px;text-align:center;font-size:44px;letter-spacing:0.5px}
.glint{position:absolute;left:1220px;top:265px;width:38px;height:38px;background:white;clip-path:polygon(50% 0,57% 42%,100% 50%,57% 57%,50% 100%,42% 57%,0 50%,42% 42%);transform-origin:center}
.under{position:absolute;left:840px;top:910px;width:240px;height:3px;background:#fc3d21;transform-origin:center}
</style><div id="root" data-composition-id="outro" data-width="1920" data-height="1080">
<div id="outro-reveal" class="mark-window"><img id="outro-mark" class="mark" src="assets/logo-galex.jpeg" alt="GaleX"></div>
<div id="outro-glint" class="glint" data-layout-ignore></div>
<div id="outro-tagline" class="tagline" data-var-text="tagline">Traza tu próxima exploración</div><div id="outro-under" class="under" data-layout-ignore></div></div>
<script>const tl=gsap.timeline({paused:true});
tl.fromTo('#outro-reveal',{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:0.8,ease:'power3.inOut'},0);
tl.fromTo('#outro-mark',{scale:0.96},{scale:1,duration:0.9,ease:'power3.out'},0);
tl.fromTo('#outro-glint',{scale:0,opacity:0},{scale:1.8,opacity:1,duration:0.2,ease:'power2.out'},0.8);
tl.to('#outro-glint',{scale:0,opacity:0,duration:0.25},1);
tl.fromTo('#outro-tagline',{y:12,opacity:0},{y:0,opacity:1,duration:0.45,ease:'power3.out'},1.1);
tl.fromTo('#outro-under',{scaleX:0},{scaleX:1,duration:0.5,ease:'power3.inOut'},1.2);
window.__timelines.outro=tl;</script></template>''')
print('10 escenas / 76 segundos / 2280 fotogramas')
