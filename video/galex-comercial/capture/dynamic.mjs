/** Captura acciones reales; requiere GaleX en :8016 y Puppeteer instalado. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.GALEX_PUPPETEER_MODULE;
const browserPath = process.env.GALEX_BROWSER_PATH;
if (!modulePath || !browserPath) throw Error('Configura GALEX_PUPPETEER_MODULE y GALEX_BROWSER_PATH');
const { default: puppeteer } = await import(pathToFileURL(modulePath));
const root = path.resolve(import.meta.dirname, '..');
const assets = path.join(root, 'assets');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await puppeteer.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--ignore-certificate-errors']});
const page = await browser.newPage();
await page.setViewport({width:1600,height:900});
await page.setRequestInterception(true);
page.on('request', req => req.method()==='POST' && !req.url().endsWith('/route') ? req.abort() : req.continue());
page.on('pageerror', e => console.log('PAGE',e.message));
const cdp = await page.createCDPSession();
const wanted = process.argv.slice(2);
let frames = null;
cdp.on('Page.screencastFrame', event => {
  if (frames) frames.push({data:Buffer.from(event.data,'base64'),time:event.metadata.timestamp});
  cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
});
async function click(selector) {
  await page.waitForSelector(selector,{visible:true,timeout:12000});
  await page.click(selector);
}
async function open(params='') {
  await page.goto('http://127.0.0.1:8016/?modal=none'+params,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.MR && MR.state && MR.state().mode,{timeout:30000});
  await sleep(700);
}
async function record(name, seconds, action) {
  if (wanted.length && !wanted.includes(name)) return;
  console.log('RECORD',name);
  const dir=await fs.mkdtemp('/tmp/galex-frames-');
  frames=[];
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1600,maxHeight:900,everyNthFrame:1});
  try { await action(); } finally { await cdp.send('Page.stopScreencast'); }
  const shots=frames;frames=null;
  if (shots.length<2) throw Error('Sin movimiento capturado: '+name);
  await Promise.all(shots.map((f,i)=>fs.writeFile(path.join(dir,i+'.jpg'),f.data)));
  const sourceDuration=shots.at(-1).time-shots[0].time;
  const ratio=seconds/Math.max(0.1,sourceDuration);
  const lines=shots.flatMap((f,i)=>[`file '${i}.jpg'`,`duration ${Math.max(1/120,((shots[i+1]?.time??f.time+1/30)-f.time)*ratio)}`]);
  lines.push(`file '${shots.length-1}.jpg'`);
  await fs.writeFile(path.join(dir,'frames.txt'),lines.join('\n'));
  const result=spawnSync('ffmpeg',['-y','-f','concat','-safe','0','-i',path.join(dir,'frames.txt'),'-t',String(seconds),'-vf','fps=30,tpad=stop_mode=clone:stop_duration=0.2','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(assets,'v2-'+name+'.mp4'),'-loglevel','error'],{encoding:'utf8'});
  if (result.status) throw Error(result.stderr);
  await page.screenshot({path:path.join(assets,'v2-'+name+'-still.png')});
  console.log('DONE',name,shots.length,'frames',sourceDuration.toFixed(2),'s');
}
async function orbit(selector, button, dx, dy, seconds=5) {
  const box=await page.$eval(selector,el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  const x=box.x+box.w*.55,y=box.y+box.h*.55;
  await page.evaluate(sel=>{const el=document.querySelector(sel);el.addEventListener('pointerdown',e=>window.__capturePointer=e.pointerId,{once:true});},selector);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button,clickCount:1});
  for (let i=1;i<=32;i++) {
    const u=i/32,e=u*u*(3-2*u);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx*e,y:y+dy*e,button,buttons:button==='right'?2:1});
    await sleep(seconds*1000/32);
  }
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button,clickCount:1});
}
async function pan(region='gale',seconds=5) {
  await page.evaluate(async ({region,seconds})=>{
    const t0=performance.now();await new Promise(resolve=>{function frame(now){const u=Math.min(1,(now-t0)/(seconds*1000)),e=u*u*(3-2*u);
    MR.Map.centerOn(region==='gale'?137.49+e*.15:77.35+e*.06,region==='gale'?-4.75-e*.14:18.42-e*.04,1.1+e*.15,false);
    if(u<1)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
  },{region,seconds});
}
try {
  if (wanted.length && wanted.every(x=>x==='controls')) {
    await open();
    await record('controls',7,async()=>{
      await page.evaluate(()=>document.getElementById('btnTheme').click());await sleep(450);
      await page.evaluate(()=>document.getElementById('btnLang').click());await sleep(450);
      await page.evaluate(()=>{document.getElementById('btnLang').click();document.querySelector('.crew [data-id="ev2"]').click();document.querySelector('[data-speed="10"]').click();});await sleep(450);
      await page.evaluate(()=>{document.querySelector('.crew [data-id="ev3"]').click();document.getElementById('btnMotion').click();});await sleep(450);
      await page.evaluate(()=>document.getElementById('btnHelp').click());await sleep(1200);
    });
    await browser.close();process.exit(0);
  }
  await open('&view=globe');await sleep(3000);
  await page.evaluate(()=>MR.Globe3D.flyTo(137.4,-4.6,14,0));
  await record('planet',8,async()=>{await orbit('#mapGlobe canvas','right',330,45,4);await page.evaluate(()=>MR.Globe3D.flyTo(137.5,-4.7,5,2200));await sleep(2400);});
  await click('[data-view="3d"]');await sleep(2000);
  await record('relief',8,async()=>{await orbit('#map3d canvas','left',-240,60,5);await sleep(500);});
  if (wanted.length && wanted.every(x=>['planet','relief'].includes(x))) { await browser.close(); process.exit(0); }
  await click('[data-view="2d"]');await sleep(400);
  await record('map',8,async()=>{await pan();await click('[data-base="color"]');await sleep(700);});
  await record('layers',8,async()=>{
    await page.evaluate(()=>{document.querySelector('[data-lptab="capas"]').click();document.getElementById('chkContours').click();});
    await pan('gale',2);
    await page.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(x=>x.textContent.startsWith('PendienteGrados'));el?.click();});
    await pan('gale',2);await click('[data-base="thermal"]');await sleep(800);
  });
  await record('regions',7,async()=>{await page.evaluate(()=>document.querySelector('[data-region="jezero"]').click());await pan('jezero',4);await sleep(500);});
  await page.evaluate(()=>document.querySelector('[data-region="gale"]').click());await sleep(600);
  await record('minerals',8,async()=>{await click('[data-lptab="minerales"]');await page.type('#minSearch','sulf',{delay:70});await sleep(500);await click('[data-act="details"]');await sleep(2300);});
  await page.keyboard.press('Escape');
  await record('objectives',6,async()=>{await click('[data-lptab="objetivos"]');await pan('gale',3);await page.evaluate(()=>{document.getElementById('distFilter').value='20';document.getElementById('distFilter').dispatchEvent(new Event('input',{bubbles:true}));});await sleep(700);});
  // Escenario corto con geometría y recursos obtenidos de la API real.
  const demo=await page.evaluate(async()=>{
    const stops=[[137.45,-4.61],[137.4416,-4.5895]];
    const response=await fetch('api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stops,profile:'segura',region:'gale'})});
    const result=await response.json();
    if (!response.ok || !result.is_valid) throw Error('La ruta de demostración no fue aprobada por el backend');
    return {stops,result};
  });
  await page.evaluate(d=>{const t=MR.state();t.mode='plan';t.crew.goalId='bradbury';t.crew.title='Exploración de demostración en Gale';t.baseRoute=d.result.alternative.points;t.adjusted=null;t.choice='model';t.stops=[];},demo);
  await click('[data-lptab="ruta"]');
  await record('planning',8,async()=>{
    await page.evaluate(()=>document.querySelector('[data-profile="rapida"]').click());await sleep(800);
    await page.evaluate(()=>document.querySelector('[data-profile="cientifica"]').click());await sleep(800);
    await page.evaluate(()=>document.querySelector('[data-profile="segura"]').click());await click('#btnRecalc');await sleep(1500);
    await page.evaluate(()=>document.getElementById('profileMetrics').scrollIntoView({block:'center',behavior:'smooth'}));await sleep(1200);
  });
  await click('#dockPlan [data-acc]');await sleep(500);
  await page.evaluate(()=>{MR.Map.centerOn(137.445,-4.6,0.85,false);});
  await record('eva',8,async()=>{await click('#btnPlay');await sleep(5000);await click('#btnPlay');await sleep(200);});
  await record('conditions',8,async()=>{await page.evaluate(()=>document.getElementById('btnConditions').click());await sleep(700);await click('[data-tab="ter"]');await sleep(1000);await click('[data-tab="mod"]');await sleep(1200);});
  await record('suit',6,async()=>{await click('[data-tab="suit"]');await sleep(1000);await page.evaluate(()=>{const p=document.querySelector('#dashTabContent')||document.querySelector('.modal .mbody');p?.scrollBy({top:180,behavior:'smooth'});});await sleep(2000);});
  await page.keyboard.press('Escape');
  await page.evaluate(()=>document.getElementById('btnDemoAlert').click());
  await record('weather',6,async()=>{await sleep(2200);await page.evaluate(()=>document.querySelector('[data-pause]')?.click());await sleep(500);});
  await record('missions',7,async()=>{await click('[data-panel="misiones"]');await sleep(900);await pan('gale',3);});
  await record('records',8,async()=>{await page.evaluate(()=>{MR.API.online=false;document.getElementById('btnReport').click();});await sleep(600);await click('[data-k="mineral"]');await page.type('textarea','Muestra de exploración GaleX',{delay:45});await click('[data-s]');await sleep(500);await click('[data-panel="hallazgos"]');await sleep(1000);});
  await record('log',7,async()=>{await click('[data-panel="bitacora"]');await sleep(700);await click('[data-t="asistente"]');await sleep(1400);await click('[data-t="tierra"]');await sleep(900);});
  await record('rovers',7,async()=>{await page.evaluate(()=>{MR.API.online=true;document.getElementById('btnRovers').click();});await sleep(2000);await page.evaluate(()=>{document.querySelector('.rover-map-body')?.scrollBy({top:150,behavior:'smooth'});});await sleep(1100);});
  await page.keyboard.press('Escape');
  await record('controls',7,async()=>{await page.evaluate(()=>{document.getElementById('btnTheme').click();});await sleep(600);await page.evaluate(()=>document.getElementById('btnLang').click());await sleep(900);await page.evaluate(()=>document.getElementById('btnLang').click());await page.evaluate(()=>document.getElementById('btnHelp').click());await sleep(1400);});
} finally { await browser.close(); }
