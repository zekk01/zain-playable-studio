const path=require('path');const {chromium}=require(path.join(require('child_process').execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
for(const [n,vp] of [['1440',{width:1440,height:900}],['400',{width:400,height:800}]]){
  const p=await b.newPage({viewport:vp});const errs=[];p.on('console',m=>{if(m.type()==='error'&&!/cityscene/.test(m.text()))errs.push(m.text())});p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:3000/',{waitUntil:'networkidle'});await p.waitForTimeout(2500);
  await p.evaluate(()=>document.getElementById('citycrafters').scrollIntoView());await p.waitForTimeout(800);
  const info=await p.evaluate(()=>({stats:document.querySelectorAll('#city-stats div').length,tabs:document.querySelectorAll('#city-tabs button').length,roles:document.querySelectorAll('.role-card').length,feature:document.querySelector('#city-feature h3')?.textContent,fallback:!document.getElementById('city-fallback').hidden,video:!!document.querySelector('#city-feature video')}));
  console.log(n,JSON.stringify(info));
  await p.screenshot({path:`dev/shots/city-${n}-a.png`});
  await p.click('#city-tabs button:nth-child(3)');await p.waitForTimeout(700);
  console.log(n,'after tab 3:',await p.evaluate(()=>document.querySelector('#city-feature h3')?.textContent));
  await p.evaluate(()=>document.getElementById('city-feature').scrollIntoView({block:'start'}));await p.waitForTimeout(400);
  await p.screenshot({path:`dev/shots/city-${n}-b.png`});
  await p.click('#city-feature [data-open-project]');await p.waitForTimeout(600);
  console.log(n,'dialog',await p.evaluate(()=>document.getElementById('detail').open),'title',await p.evaluate(()=>document.getElementById('detail-title')?.textContent));
  await p.evaluate(()=>document.getElementById('detail').close());
  await p.evaluate(()=>document.getElementById('city-roles').scrollIntoView({block:'end'}));await p.waitForTimeout(400);
  await p.screenshot({path:`dev/shots/city-${n}-c.png`});
  console.log(n,'errors',errs);await p.close();
}
await b.close();})();
