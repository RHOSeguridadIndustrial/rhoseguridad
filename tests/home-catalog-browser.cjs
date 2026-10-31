const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.webp':'image/webp','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg'};
 res.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');
 try{
 let body=fs.readFileSync(path.join(process.cwd(),p==='/'?'index.html':p));
 // Focus visual checks on production homepage/catalog code, with unrelated
 // account/cart/avatar modules excluded. Never contact live services in CI.
 if(p==='/'||p==='/index.html')body=body.toString().replace(/<script[^>]*type="module"[^>]*>[\s\S]*?<\/script>/g,s=>s.includes('home-catalog.js')?s:'');
 res.end(body);
 }catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 for(const filename of ['index.html','cuenta.html'])assert.doesNotMatch(fs.readFileSync(filename,'utf8'),/data-purchase-recommendations|recommendations\.(css|js)/);
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch();
  try{for(const width of [320,390,430,768,1280]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   await page.goto(origin+'/index.html');await page.locator('.rho-home-product').last().waitFor();
   const section=page.locator('.rho-home');await section.scrollIntoViewIfNeeded();
   assert.equal(await page.locator('.rho-home-product').count(),18);
   assert.equal(await page.locator('.rho-home__chips a').count(),10);
   assert.equal(await page.locator('.rho-home-card').count(),6);
   for(const card of await page.locator('.rho-home-card').all()){
    const products=await card.locator('.rho-home-product').evaluateAll(links=>links.map(link=>{
     const rect=link.getBoundingClientRect();return {left:Math.round(rect.left),top:Math.round(rect.top)};
    }));
    assert.equal(products.length,3,'Each module contains three products');
    assert.equal(new Set(products.map(p=>p.left)).size,1,'Each module uses one product column');
    assert.equal(new Set(products.map(p=>p.top)).size,3,'Each module uses three product rows');
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   for(const link of await page.locator('.rho-home a').all()){
    const href=await link.getAttribute('href');assert.ok(fs.existsSync(href.split('?')[0]));
   }
   // Every product photograph is an actual, decodable catalog asset.
   for(const img of await page.locator('.rho-home-product:visible img').all()){
    await img.scrollIntoViewIfNeeded();
    const label=await img.locator('..').locator('..').innerText();
    try { await page.waitForFunction(image=>image.complete && image.naturalWidth>0,await img.elementHandle(),{timeout:10000}); } catch { throw new Error('Catalog image did not load: '+label); }
    if((await img.getAttribute('src')).includes('tapones-3m-')) await img.evaluate(image=>image.decode());
   }
   if(width<=900){
    await page.locator('#rho-home-modules').evaluate(el=>el.scrollLeft=0);
    await page.getByRole('button',{name:'Ver siguiente módulo',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#rho-home-modules').scrollLeft>20);
   }else assert.equal(await page.locator('#rho-home-controls').isVisible(),false);
   await page.locator('#rho-home-modules').evaluate(el=>el.scrollLeft=0);
   if(width<=600){
    const metrics=await page.locator('#rho-home-modules').evaluate(el=>{
     const cards=[...el.children].map(c=>c.getBoundingClientRect());
     const products=[...el.querySelectorAll('.rho-home-product')].filter(p=>p.offsetWidth).map(p=>p.getBoundingClientRect());
     const viewport=el.getBoundingClientRect();
     return {rows:[...new Set(products.map(p=>Math.round(p.top)))].length,
      columns:[...new Set(products.map(p=>Math.round(p.left)))].length,
      visibleCards:cards.filter(c=>c.left>=viewport.left-1&&c.right<=viewport.right+1).length,
      cardWidth:cards[0].width,viewportWidth:el.clientWidth,
      height:Math.max(...cards.map(c=>c.height))};
    });
    assert.equal(await page.locator('.rho-home-product:visible').count(),18);
    assert.equal(metrics.columns,6,'Keep six columns in the mobile carousel');
    assert.equal(metrics.visibleCards,3,'Show three full modules at a time');
    assert.ok(Math.abs(metrics.cardWidth-(metrics.viewportWidth-14)/3)<1,'Preserve the compact module width');
    assert.equal(metrics.rows,3,'Align products in three rows');
    assert.ok(metrics.height<=410,'Keep all mobile modules compact');
    for(const product of await page.locator('.rho-home-product').all()){
     assert.ok((await product.getAttribute('aria-label')).length>5,'Retain full accessible product name');
    }
    for(const img of await page.locator('.rho-home-product:visible img').all()){
     assert.ok(await img.evaluate(image=>{
      const box=image.parentElement.getBoundingClientRect(),photo=image.getBoundingClientRect();
      return photo.top>=box.top-1&&photo.bottom<=box.bottom+1&&photo.left>=box.left-1&&photo.right<=box.right+1;
     }),'Show the complete photo without container cropping');
    }
    await page.locator('#rho-home-modules').evaluate(el=>el.scrollLeft=el.scrollWidth);
    await page.waitForFunction(()=>{
     const root=document.querySelector('#rho-home-modules'),last=root.lastElementChild.getBoundingClientRect(),box=root.getBoundingClientRect();
     return last.right<=box.right+1&&last.left>=box.left-1;
    });
    await section.scrollIntoViewIfNeeded();
    fs.mkdirSync('tests/home-previews',{recursive:true});
    await section.screenshot({path:`tests/home-previews/${engine.name()}-${width}-last.png`});
    await page.locator('#rho-home-modules').evaluate(el=>el.scrollLeft=0);
    console.log(`MOBILE ${engine.name()} ${width}px: ${Math.round(metrics.height)}px tall, 6 modules, 3 visible, all reachable`);
   }
   await section.scrollIntoViewIfNeeded();
   fs.mkdirSync('tests/home-previews',{recursive:true});
   await section.screenshot({path:`tests/home-previews/${engine.name()}-${width}.png`});
   assert.equal(await page.locator('.banner-track a[href="portafolio.html"]').count(),3);
   assert.equal(await page.locator('img[alt="Pago con tarjeta muy pronto. Mientras, cotiza y paga por transferencia."]').count(),1);
   assert.equal(await page.locator('#contacto,#quoteForm').count(),0);
   assert.equal(await page.locator('#main-menu a[href="cotizador.html"]').count(),1);
   assert.deepEqual(errors,[]);
   await page.close();console.log(`PASS ${engine.name()} ${width}px: cards, images, links, scrolling, existing banners`);
  }}finally{await browser.close()}
 }
}finally{server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
