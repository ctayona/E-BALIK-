// Windows hidden Edge; mocked fixture and CSP prevent live service access.
import {build} from "esbuild";
import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {pathToFileURL} from "node:url";
const folder=path.resolve("node_modules/.cache/privacy-browser");fs.mkdirSync(folder,{recursive:true});
await build({entryPoints:["scripts/fixtures/scan-privacy-review.tsx"],outfile:folder+"/fixture.js",bundle:true,platform:"browser",jsx:"automatic",loader:{".css":"empty",".webp":"dataurl",".svg":"dataurl",".png":"dataurl",".jpg":"dataurl"},alias:{react:path.resolve("node_modules/react"),"react-dom":path.resolve("node_modules/react-dom"),"@":path.resolve("Users/Frontend/src")},define:{"import.meta.env":JSON.stringify({VITE_API_URL:"http://offline.invalid"})}});
for(const [kind,base]of[["admin","Admin/Frontend/dist/assets"],["user","Users/Frontend/dist/assets"]]){
 fs.writeFileSync(folder+`/${kind}.css`,fs.readdirSync(base).filter(f=>f.endsWith(".css")).map(f=>fs.readFileSync(base+"/"+f,"utf8")).join("\n"));
}
fs.writeFileSync(folder+"/index.html",'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';img-src data:;font-src data:"><link id="fixture-theme" rel="stylesheet"><div id="root"></div><p id="qa"></p><script src="fixture.js"></script>');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"ebalik-privacy-cdp-"));
const browser=spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",["--headless","--disable-gpu","--disable-background-networking","--no-first-run","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{windowsHide:true,stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
 let port;for(let i=0;i<40;i++){try{port=fs.readFileSync(profile+"/DevToolsActivePort","utf8").split("\n")[0];if(port)break;}catch{}await sleep(250);}
 if(!port)throw Error("Browser debugger unavailable");
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(pages.find(p=>p.type==="page").webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let seq=0;const pending=new Map();socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p?.reject(Error(d.error.message)):p?.resolve(d.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 await send("Page.enable");
 for(const mode of ["scan-desktop","scan-mobile","scan-mobile-dark","review-desktop","review-mobile","review-mobile-dark","activity-desktop","activity-mobile","activity-mobile-dark"]){
  await send("Emulation.setDeviceMetricsOverride",{width:mode.includes("mobile")?390:1440,height:1000,deviceScaleFactor:1,mobile:mode.includes("mobile")});
  await send("Page.navigate",{url:pathToFileURL(folder+"/index.html").href+"?mode="+mode});
  let qa;for(let i=0;i<100;i++){await sleep(150);const d=await send("Runtime.evaluate",{expression:'({qa:document.body.dataset.qa,text:document.getElementById("qa")?.textContent})',returnByValue:true});qa=d.result?.value;if(qa?.qa)break;}
  const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(folder+"/"+mode+".png",Buffer.from(shot.data,"base64"));
  console.log(JSON.stringify({mode,...qa}));if(qa?.qa!=="pass")throw Error("Fixture failed "+mode+": "+qa?.text);
 }
 await Promise.race([send("Browser.close"),sleep(500)]);
}finally{socket?.close();browser.kill();}
