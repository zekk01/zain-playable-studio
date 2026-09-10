const path=require('path');const {chromium}=require(path.join(require('child_process').execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:400,height:800}});await p.goto('http://localhost:3000/',{waitUntil:'networkidle'});await p.waitForTimeout(3000);
await p.evaluate(()=>document.querySelector('.scene-bottom').scrollIntoView({block:'end'}));await p.waitForTimeout(600);
const info=await p.evaluate(()=>({compact:document.getElementById('studio-canvas').classList.contains('is-compact'),legendDisplay:getComputedStyle(document.getElementById('scene-legend')).display,buttons:document.querySelectorAll('#scene-legend button').length,labelsVisible:[...document.querySelectorAll('#scene-labels .hotspot__label')].filter(l=>getComputedStyle(l).display!=='none').length}));
console.log(JSON.stringify(info));await p.screenshot({path:'dev/shots/legend-400.png'});await b.close();})();
