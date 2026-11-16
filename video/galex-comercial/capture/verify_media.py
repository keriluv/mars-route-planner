"""Verifica duración, decodificación y cambio de imagen de la captura V2."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
coverage = json.loads((ROOT / 'coverage.json').read_text())

def check(scene):
    name = scene['scene']
    media = ROOT / 'assets' / f'v2-{name}.mp4'
    data = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries',
        'format=duration:stream=avg_frame_rate','-of','json',str(media)]))
    duration = float(data['format']['duration'])
    assert abs(duration-scene['duration']) < 1/30 + 0.001, name
    assert data['streams'][0]['avg_frame_rate'] == '30/1', name
    decoded = subprocess.run(['ffmpeg','-v','error','-i',str(media),'-f','null','-'],
                             capture_output=True, text=True)
    assert decoded.returncode == 0 and not decoded.stderr.strip(), (name, decoded.stderr)
    result = {'scene':name,'duration':duration,'fps':30,'decode_errors':0}
    if name in ('planet','relief','map','regions'):
        frames=[]
        for time in (1,3,6):
            raw = subprocess.check_output(['ffmpeg','-v','error','-ss',str(time),'-i',str(media),
                '-vf','crop=iw*0.7:ih*0.7:iw*0.25:ih*0.2,scale=320:180,format=gray',
                '-frames:v','1','-f','rawvideo','-'])
            frames.append(np.frombuffer(raw,dtype=np.uint8).astype(float))
        changes=[float(np.abs(a-b).mean()) for a,b in zip(frames,frames[1:])]
        assert max(changes)>1, (name, 'No se detectó cambio apreciable del terreno')
        result['terrain_mean_absolute_change']=changes
    return result

with ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(check,coverage['scenes']))
intervals=[b['start']-a['start'] for a,b in zip(coverage['scenes'],coverage['scenes'][1:])]
assert max(intervals)<=10
report={'duration':coverage['duration'],'max_seconds_between_features':max(intervals),
        'media':results,'note':'Cambio de imagen y decodificación; no mide rendimiento real del producto ni sustituye revisión visual.'}
(ROOT/'media-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('17 medios válidos; cambio de función cada',max(intervals),'segundos como máximo')
