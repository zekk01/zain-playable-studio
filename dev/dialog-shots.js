const path=require('path');const {chromium}=require(path.join(require('child_process').execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:1440,height:900}});const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:3000/',{waitUntil:'networkidle'});await p.waitForTimeout(2500);
const shots=[[0,0,'pit-protocol'],[0,2,'unseen-blade'],[0,3,'target-destroyed'],[2,0,'chronicles'],[3,0,'feral-creature'],[4,0,'swave'],[5,0,'abjadpolis'],[7,0,'gaya']];
for(const [ci,pi,name] of shots){
  await p.click(`#company-list button:nth-child(${ci+1})`);await p.waitForTimeout(700);
  await p.evaluate(()=>document.getElementById('work').scrollIntoView());await p.waitForTimeout(400);
  await p.screenshot({path:`dev/shots/tab-${name}.png`});
  await p.click(`.project[data-project="${pi}"]`);await p.waitForTimeout(900);
  const info=await p.evaluate(()=>({videos:document.querySelectorAll('#detail video').length,imgs:document.querySelectorAll('#detail .detail-strip button').length,title:document.getElementById('detail-title')?.textContent}));
  console.log(name,JSON.stringify(info));
  await p.screenshot({path:`dev/shots/dialog-${name}.png`});
  if(info.videos){ await p.evaluate(()=>{const d=document.getElementById('detail'); d.scrollTop=420;}); await p.waitForTimeout(400); await p.screenshot({path:`dev/shots/dialog-${name}-videos.png`}); }
  await p.evaluate(()=>document.getElementById('detail').close());await p.waitForTimeout(300);
}
console.log('console errors',errs.length,errs.slice(0,4));await b.close();})();
