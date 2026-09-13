const W=9,H=17,PADDLE=3;
const API='https://sundai.willsarg.com/api/i/mellow-heron/frame';
const META_API='https://sundai.willsarg.com/api/i/mellow-heron';
const LEASE_MS=4000;
const HEARTBEAT_MS=1000;
const SPECTATOR_POLL_MS=1500;

const board=document.getElementById('board'),statusEl=document.getElementById('status'),fpsEl=document.getElementById('fps');
const topScoreEl=document.getElementById('topScore'),bottomScoreEl=document.getElementById('bottomScore');
const topOwnerEl=document.getElementById('topOwner'),bottomOwnerEl=document.getElementById('bottomOwner');
const eventEl=document.getElementById('gameEvent'),controllerEl=document.getElementById('controllerState');
const pixels=[];
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=document.createElement('div');p.className='pixel';board.appendChild(p);pixels.push(p)}

let running=false,timer=null,topX=3,bottomX=3,ballX=4,ballY=8,dx=1,dy=1,topScore=0,bottomScore=0,sendBusy=false,pendingFrame=null,sendCount=0;
let topHuman=false,bottomHuman=false;
let controllerState='checking'; // checking | active | spectator
let heartbeatTimer=null,spectatorTimer=null,acquiring=false;

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const jitter=(min,max)=>Math.floor(min+Math.random()*(max-min));

function resetBall(dir){ballX=4;ballY=8;dx=Math.random()<.5?-1:1;dy=dir??(Math.random()<.5?-1:1)}
function resetGame(){topX=bottomX=3;topScore=bottomScore=0;topScoreEl.textContent=0;bottomScoreEl.textContent=0;if(eventEl)eventEl.textContent='';resetBall();draw()}
function updateOwners(){topOwnerEl.textContent=topHuman?'HUMAN':'AI';bottomOwnerEl.textContent=bottomHuman?'HUMAN':'AI';topOwnerEl.className=topHuman?'owner human':'owner';bottomOwnerEl.className=bottomHuman?'owner human':'owner'}

function setControlEnabled(enabled){
  document.querySelectorAll('[data-move],#start,#pause,#reset,#fps').forEach(el=>el.disabled=!enabled);
}
function showControllerState(){
  if(!controllerEl)return;
  if(controllerState==='active'){controllerEl.textContent='YOU HAVE CONTROL';controllerEl.className='controller-state active'}
  else if(controllerState==='spectator'){controllerEl.textContent='GAME IN USE · SPECTATOR';controllerEl.className='controller-state spectator'}
  else{controllerEl.textContent='CHECKING CONTROLLER…';controllerEl.className='controller-state'}
}
function becomeSpectator(){
  controllerState='spectator';
  if(timer){clearInterval(timer);timer=null} running=false;
  if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null}
  pendingFrame=null;
  setControlEnabled(false);showControllerState();
  statusEl.textContent='Another laptop is controlling the game. You are in spectator mode.';
  if(eventEl)eventEl.textContent='GAME IN USE';
  if(!spectatorTimer)spectatorTimer=setInterval(()=>attemptAcquire(false),SPECTATOR_POLL_MS);
}
function becomeController(){
  controllerState='active';
  if(spectatorTimer){clearInterval(spectatorTimer);spectatorTimer=null}
  setControlEnabled(true);showControllerState();
  if(eventEl)eventEl.textContent='YOU HAVE CONTROL';
  start();
  if(heartbeatTimer)clearInterval(heartbeatTimer);
  heartbeatTimer=setInterval(()=>{if(controllerState==='active')sendCurrentFrame()},HEARTBEAT_MS);
}

async function getMeta(){
  try{
    const r=await fetch(`${META_API}?t=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){
    console.error('controller lease check failed',e);
    return null;
  }
}
function leaseIsFresh(meta){
  return !!(meta&&meta.last_frame_at&&Date.now()-Number(meta.last_frame_at)<LEASE_MS);
}
async function attemptAcquire(initial=true){
  if(acquiring||controllerState==='active')return;
  acquiring=true;
  try{
    controllerState='checking';showControllerState();
    const first=await getMeta();
    if(leaseIsFresh(first)){becomeSpectator();return}

    // Randomized second check prevents two public visitors opening the link together
    // from normally acquiring at the same instant.
    await sleep(jitter(initial?180:80,initial?650:450));
    const second=await getMeta();
    if(leaseIsFresh(second)){becomeSpectator();return}

    // Claim by publishing our current frame. Subsequent visitors now see a fresh live timestamp.
    controllerState='active';
    setControlEnabled(true);showControllerState();
    await sendCurrentFrame(true);
    becomeController();
  }finally{acquiring=false}
}

function move(which,delta){if(controllerState!=='active')return;if(which==='top')topX=clamp(topX+delta,0,W-PADDLE);else bottomX=clamp(bottomX+delta,0,W-PADDLE);draw();if(running)sendCurrentFrame()}
function humanMove(which,delta){if(controllerState!=='active')return;if(which==='top')topHuman=true;else bottomHuman=true;updateOwners();move(which,delta)}
function aiMove(which){const x=which==='top'?topX:bottomX,center=x+1,target=ballX;if(target<center)return clamp(x-1,0,W-PADDLE);if(target>center)return clamp(x+1,0,W-PADDLE);return x}
function bounceDx(hit,paddle,current){const c=paddle+1;return hit<c?-1:hit>c?1:(current||1)}
function inPaddle(x,paddle){return x>=paddle&&x<paddle+PADDLE}
function paddleContact(paddle,currentX,nextX){return inPaddle(currentX,paddle)||inPaddle(nextX,paddle)}
function registerHit(which,paddle,nextX){
  const hitX=clamp(nextX,paddle,paddle+PADDLE-1);
  if(which==='top'){dy=1;ballY=1}else{dy=-1;ballY=H-2}
  dx=bounceDx(hitX,paddle,dx);ballX=hitX;
  if(eventEl)eventEl.textContent=`${which.toUpperCase()} DEFLECTS`;
}
function awardPoint(which){
  if(which==='top'){topScore++;topScoreEl.textContent=topScore;resetBall(-1)}
  else{bottomScore++;bottomScoreEl.textContent=bottomScore;resetBall(1)}
  if(eventEl)eventEl.textContent=`${which.toUpperCase()} SCORES`;
}
function step(){
  if(controllerState!=='active')return;
  if(!topHuman&&(dy<0||Math.random()<.15))topX=aiMove('top');
  if(!bottomHuman&&(dy>0||Math.random()<.15))bottomX=aiMove('bottom');
  let nx=ballX+dx,ny=ballY+dy;
  if(nx<0||nx>=W){dx*=-1;nx=ballX+dx}
  if(ny<=0){
    if(paddleContact(topX,ballX,nx))registerHit('top',topX,nx);
    else awardPoint('bottom');
  }else if(ny>=H-1){
    if(paddleContact(bottomX,ballX,nx))registerHit('bottom',bottomX,nx);
    else awardPoint('top');
  }else{
    ballX=nx;ballY=ny;
    if(eventEl)eventEl.textContent='';
  }
  draw();sendCurrentFrame();
}
function draw(){for(const p of pixels)p.className='pixel';for(let x=topX;x<topX+PADDLE;x++)pixels[x].className='pixel top';for(let x=bottomX;x<bottomX+PADDLE;x++)pixels[(H-1)*W+x].className='pixel bottom';pixels[ballY*W+ballX].className='pixel ball'}
function rgbFrame(){const f=Array.from({length:H},()=>Array.from({length:W},()=>[0,0,0]));for(let x=topX;x<topX+PADDLE;x++)f[0][x]=[0,170,255];for(let x=bottomX;x<bottomX+PADDLE;x++)f[H-1][x]=[255,120,0];f[ballY][ballX]=[255,255,255];return f}
function takeoverText(){if(topHuman&&bottomHuman)return ' · both paddles human';if(topHuman)return ' · top human / bottom AI';if(bottomHuman)return ' · top AI / bottom human';return ' · both paddles AI'}
async function pumpFrame(frame){
  sendBusy=true;
  try{
    const r=await fetch(API,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(frame),cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    sendCount++;
    if(controllerState==='active')statusEl.textContent=`Controller active · ${sendCount} frames sent${takeoverText()}.`;
    return true;
  }catch(e){
    statusEl.textContent=`Display send failed: ${e.message}.`;
    console.error('mellow-heron frame send failed',e);
    return false;
  }finally{
    sendBusy=false;
    if(pendingFrame&&controllerState==='active'){const next=pendingFrame;pendingFrame=null;pumpFrame(next)}
  }
}
function sendCurrentFrame(force=false){
  if(controllerState!=='active'&&!force)return Promise.resolve(false);
  const frame=rgbFrame();
  if(sendBusy){pendingFrame=frame;return Promise.resolve(true)}
  return pumpFrame(frame);
}
function start(){if(controllerState!=='active'||running)return;running=true;const ms=1000/Number(fpsEl.value);timer=setInterval(step,ms);statusEl.textContent='You have the controller. Sending to mellow-heron…';sendCurrentFrame()}
function pause(){if(controllerState!=='active')return;running=false;if(timer){clearInterval(timer);timer=null}statusEl.textContent='Paused, but this laptop still holds the controller lock.'}
function restartTimer(){if(controllerState==='active'&&running){clearInterval(timer);timer=setInterval(step,1000/Number(fpsEl.value))}}

document.getElementById('start').onclick=start;
document.getElementById('pause').onclick=pause;
document.getElementById('reset').onclick=()=>{if(controllerState!=='active')return;resetGame();sendCurrentFrame()};
fpsEl.onchange=restartTimer;
document.querySelectorAll('[data-move]').forEach(b=>{const [who,dir]=b.dataset.move.split('-');b.addEventListener('pointerdown',e=>{e.preventDefault();humanMove(who,dir==='left'?-1:1)})});
window.addEventListener('keydown',e=>{
  const k=e.key;
  if(['ArrowLeft','ArrowRight','a','A','d','D'].includes(k)){e.preventDefault();e.stopPropagation()}
  if(controllerState!=='active')return;
  if(k==='a'||k==='A')humanMove('top',-1);
  else if(k==='d'||k==='D')humanMove('top',1);
  else if(k==='ArrowLeft')humanMove('bottom',-1);
  else if(k==='ArrowRight')humanMove('bottom',1);
},{capture:true});

updateOwners();resetGame();setControlEnabled(false);showControllerState();attemptAcquire(true);
