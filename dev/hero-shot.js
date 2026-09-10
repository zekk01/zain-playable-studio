const path=require('path');const {chromium}=require(path.join(require('child_process').execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
for(const [n,vp] of [['1440',{width:1440,height:900}],['400',{width:400,height:800}]]){const p=await b.newPage({viewport:vp});const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:3000/',{waitUntil:'networkidle'});await p.waitForTimeout(3200);await p.mouse.move(vp.width*0.7,vp.height*0.5);await p.waitForTimeout(600);
await p.screenshot({path:`dev/shots/hero-tuned-${n}.png`});console.log(n,'errors',errs.length,errs.slice(0,3));await p.close();}
await b.close();})();
