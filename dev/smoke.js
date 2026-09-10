const path=require('path');const {chromium}=require(path.join(require('child_process').execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  for(const [name,vp] of [['desktop',{width:1440,height:900}],['mobile',{width:400,height:800}]]){
    const ctx=await browser.newContext({viewport:vp,deviceScaleFactor:1});
    const page=await ctx.newPage(); const errors=[]; const warnings=[]; const failed=[];
    page.on('console',m=>{ if(m.type()==='error')errors.push(m.text()); else if(m.type()==='warning')warnings.push(m.text()); });
    page.on('pageerror',e=>errors.push('PAGEERROR '+e.message));
    page.on('response',r=>{ if(r.status()>=400) failed.push(r.status()+' '+r.url()); });
    await page.goto('http://localhost:3000/',{waitUntil:'networkidle',timeout:60000});
    await page.waitForTimeout(2500);
    await page.screenshot({path:`dev/shots/smoke-${name}-hero.png`});
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await page.waitForTimeout(1500);
    await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(500);
    await page.screenshot({path:`dev/shots/smoke-${name}-full.png`,fullPage:true});
    const info=await page.evaluate(()=>({companies:document.querySelectorAll('#company-list button').length,projects:document.querySelectorAll('.project').length,reels:document.querySelectorAll('.reel').length,rail:document.querySelectorAll('#poker-rail button').length,toc:document.querySelectorAll('#book-toc li').length,fallbackShown:!document.getElementById('scene-fallback').hidden,flipbookChildren:document.getElementById('flipbook').children.length,h:document.body.scrollHeight}));
    console.log(name,JSON.stringify(info));
    console.log(name,'errors',errors.length,errors.slice(0,6)); console.log(name,'warnings',warnings.length,warnings.slice(0,4)); console.log(name,'failed requests',failed.slice(0,8));
    // open a project dialog
    await page.click('.project'); await page.waitForTimeout(600); await page.screenshot({path:`dev/shots/smoke-${name}-dialog.png`});
    console.log(name,'dialog open',await page.evaluate(()=>document.getElementById('detail').open));
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  await browser.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)});
