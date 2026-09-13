const W=9,H=17,PADDLE=3,TARGET_SCORE=5;
const DIRECT_API='https://sundai.willsarg.com/api/i/mellow-heron/frame';
const META_API='https://sundai.willsarg.com/api/i/mellow-heron';
const CONTROL_API=(window.PONG_CONTROL_API||'').replace(/\/$/,'');
const USE_QUEUE=!!CONTROL_API;
const LEASE_MS=4000;
const HEARTBEAT_MS=1000;
const SPECTATOR_POLL_MS=1500;
const QUEUE_POLL_MS=2000;
const POST_MATCH_COOLDOWN_MS=15000;

const board=document.getElementById('board'),statusEl=document.getElementById('status'),fpsEl=document.getElementById('fps');
const topScoreEl=document.getElementById('topScore'),bottomScoreEl=document.getElementById('bottomScore');
const topOwnerEl=document.getElementById('topOwner'),bottomOwnerEl=document.getElementById('bottomOwner');
const eventEl=document.getElementById('gameEvent'),controllerEl=document.getElementById('controllerState');
const pixels=[];
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=document.createElement('div');p.className='pixel';board.appendChild(p);pixels.push(p)}

let running=false,timer=null,topX=3,bottomX=3,ballX=4,ballY=8,dx=1,dy=1,topScore=0,bottomScore=0,sendBusy=false,pendingFrame=null,sendCount=0;
let topHuman=false,bottomHuman=false,matchOver=false;
let controllerState='checking'; // checking | active | spectator
let heartbeatTimer=null,spectatorTimer=null,queueTimer=null,acquiring=false,reacquireNotBefore=0;
let controllerToken='',queuePosition=null,queueLength=0;

function getClientId(){
  const key='pong-sundai-client-id';
  let id=localStorage.getItem(key)||'';
  if(!/^[A-Za-z0-9_-]{12,128}$/.test(id)){
    id=(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g,'-');
    localStorage.setItem(key,id);
  }
  return id;
}
const clientId=getClientId();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const jitter=(min,max)=>Math.floor(min+Math.random()*(max-min));

function resetBall(dir){ballX=4;ballY=8;dx=Math.random()<.5?-1:1;dy=dir??(Math.random()<.5?-1:1)}
function resetGame(){topX=bottomX=3;topScore=bottomScore=0;topScoreEl.textContent=0;bottomScoreEl.textContent=0;matchOver=false;if(eventEl)eventEl.textContent='FIRST TO 5';resetBall();draw()}
function updateOwners(){topOwnerEl.textContent=topHuman?'HUMAN':'AI';bottomOwnerEl.textContent=bottomHuman?'HUMAN':'AI';topOwnerEl.className=topHuman?'owner human':'owner';bottomOwnerEl.className=bottomHuman?'owner human':'owner'}

function setControlEnabled(enabled){
  document.querySelectorAll('[data-move],#start,#pause,#reset,#fps').forEach(el=>el.disabled=!enabled);
}
function showControllerState(){
  if(!controllerEl)return;
  if(controllerState==='active'){
    controllerEl.textContent=USE_QUEUE&&queueLength?`YOU HAVE CONTROL · ${queueLength} WAITING`:'YOU HAVE CONTROL';
    controllerEl.className='controller-state active';
  }else if(controllerState==='spectator'){
    controllerEl.textContent=USE_QUEUE&&queuePosition?`IN QUEUE · #${queuePosition}`:'GAME IN USE · SPECTATOR';
    controllerEl.className='controller-state spectator';
  }else{
    controllerEl.textContent=USE_QUEUE?'JOINING QUEUE…':'CHECKING CONTROLLER…';
    controllerEl.className='controller-state';
  }
}
function clearPlayTimers(){
  if(timer){clearInterval(timer);timer=null}
  if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null}
  running=false;pendingFrame=null;
}
function becomeSpectator(message){
  controllerState='spectator';
  clearPlayTimers();
  setControlEnabled(false);showControllerState();
  statusEl.textContent=message||(USE_QUEUE&&queuePosition?`You are #${queuePosition} in line. You will get control automatically.`:'Another laptop is controlling the game. You are in spectator mode.');
  if(eventEl)eventEl.textContent=USE_QUEUE&&queuePosition?`QUEUE POSITION ${queuePosition}`:(matchOver?'WAITING FOR NEXT PLAYER':'GAME IN USE');
  if(USE_QUEUE){
    if(!queueTimer)queueTimer=setInterval(pollQueue,QUEUE_POLL_MS);
  }else if(!spectatorTimer){
    spectatorTimer=setInterval(()=>attemptAcquire(false),SPECTATOR_POLL_MS);
  }
}
function becomeController(){
  const wasActive=controllerState==='active';
  controllerState='active';
  if(spectatorTimer){clearInterval(spectatorTimer);spectatorTimer=null}
  if(queueTimer){clearInterval(queueTimer);queueTimer=null}
  topHuman=false;bottomHuman=false;updateOwners();
  if(!wasActive)resetGame();
  setControlEnabled(true);showControllerState();
  if(eventEl)eventEl.textContent='FIRST TO 5';
  start();
  if(heartbeatTimer)clearInterval(heartbeatTimer);
  heartbeatTimer=setInterval(()=>{if(controllerState==='active'){USE_QUEUE?heartbeatQueue():sendCurrentFrame()}},HEARTBEAT_MS);
}

async function backendRequest(path,{method='GET',body=null,auth=false,keepalive=false}={}){
  const headers={};
  if(body!==null)headers['Content-Type']='application/json';
  if(auth&&controllerToken)headers.Authorization=`Bearer ${controllerToken}`;
  const r=await fetch(`${CONTROL_API}${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:'no-store',keepalive});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const err=new Error(data.error||`HTTP ${r.status}`);err.status=r.status;throw err}
  return data;
}
async function applyQueueState(state){
  queueLength=Number(state.queueLength||0);
  queuePosition=state.position==null?null:Number(state.position);
  if(state.state==='active'){
    controllerToken=state.token||controllerToken;
    becomeController();
    showControllerState();
  }else if(state.state==='queued'){
    controllerToken='';
    becomeSpectator(`You are #${queuePosition} in the player queue. Your turn starts automatically.`);
  }else{
    await joinQueue();
  }
}
async function joinQueue(){
  if(!USE_QUEUE)return;
  try{
    controllerState='checking';showControllerState();
    const state=await backendRequest('/api/join',{method:'POST',body:{clientId}});
    await applyQueueState(state);
  }catch(e){
    console.error('queue join failed',e);
    controllerState='spectator';showControllerState();setControlEnabled(false);
    statusEl.textContent=`Queue service unavailable: ${e.message}. Retrying…`;
    if(!queueTimer)queueTimer=setInterval(joinQueue,QUEUE_POLL_MS);
  }
}
async function pollQueue(){
  if(!USE_QUEUE||controllerState==='active')return;
  try{
    const state=await backendRequest(`/api/status?clientId=${encodeURIComponent(clientId)}`);
    await applyQueueState(state);
  }catch(e){console.error('queue poll failed',e)}
}
async function heartbeatQueue(){
  if(!USE_QUEUE||controllerState!=='active'||!controllerToken)return;
  try{
    const state=await backendRequest('/api/heartbeat',{method:'POST',auth:true});
    queueLength=Number(state.queueLength||0);showControllerState();
  }catch(e){
    console.error('queue heartbeat failed',e);
    if(e.status===401){controllerToken='';await joinQueue()}
  }
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
function leaseIsFresh(meta){return !!(meta&&meta.last_frame_at&&Date.now()-Number(meta.last_frame_at)<LEASE_MS)}
async function attemptAcquire(initial=true){
  if(USE_QUEUE||acquiring||controllerState==='active'||Date.now()<reacquireNotBefore)return;
  acquiring=true;
  try{
    controllerState='checking';showControllerState();
    const first=await getMeta();
    if(leaseIsFresh(first)){becomeSpectator();return}
    await sleep(jitter(initial?180:80,initial?650:450));
    const second=await getMeta();
    if(leaseIsFresh(second)){becomeSpectator();return}
    controllerState='active';setControlEnabled(true);showControllerState();
    await sendCurrentFrame(true);becomeController();
  }finally{acquiring=false}
}

function move(which,delta){if(controllerState!=='active'||matchOver)return;if(which==='top')topX=clamp(topX+delta,0,W-PADDLE);else bottomX=clamp(bottomX+delta,0,W-PADDLE);draw();if(running)sendCurrentFrame()}
function humanMove(which,delta){if(controllerState!=='active'||matchOver)return;if(which==='top')topHuman=true;else bottomHuman=true;updateOwners();move(which,delta)}
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
async function finishMatch(which){
  matchOver=true;clearPlayTimers();setControlEnabled(false);
  if(eventEl)eventEl.textContent=`${which.toUpperCase()} WINS · FIRST TO 5`;
  statusEl.textContent='Game over at 5 points.';
  await sendCurrentFrame(true).catch(()=>false);

  if(USE_QUEUE){
    try{
      const state=await backendRequest('/api/game-over',{method:'POST',auth:true});
      if(state.continued){
        controllerToken=state.token||controllerToken;
        queueLength=Number(state.queueLength||0);queuePosition=0;
        topHuman=false;bottomHuman=false;updateOwners();resetGame();
        statusEl.textContent='No one is waiting — starting another first-to-5 match.';
        controllerState='active';becomeController();
      }else{
        await applyQueueState(state);
      }
    }catch(e){
      console.error('game handoff failed',e);controllerToken='';await joinQueue();
    }
  }else{
    reacquireNotBefore=Date.now()+POST_MATCH_COOLDOWN_MS;
    setTimeout(()=>becomeSpectator('Match finished at 5 points. Waiting for another player to take control.'),900);
  }
}
function awardPoint(which){
  let score;
  if(which==='top'){topScore++;score=topScore;topScoreEl.textContent=topScore}
  else{bottomScore++;score=bottomScore;bottomScoreEl.textContent=bottomScore}
  if(score>=TARGET_SCORE){finishMatch(which);return true}
  resetBall(which==='top'?-1:1);
  if(eventEl)eventEl.textContent=`${which.toUpperCase()} SCORES · FIRST TO 5`;
  return false;
}
function step(){
  if(controllerState!=='active'||matchOver)return;
  if(!topHuman&&(dy<0||Math.random()<.15))topX=aiMove('top');
  if(!bottomHuman&&(dy>0||Math.random()<.15))bottomX=aiMove('bottom');
  let nx=ballX+dx,ny=ballY+dy;
  if(nx<0||nx>=W){dx*=-1;nx=ballX+dx}
  let ended=false;
  if(ny<=0){
    if(paddleContact(topX,ballX,nx))registerHit('top',topX,nx);
    else ended=awardPoint('bottom');
  }else if(ny>=H-1){
    if(paddleContact(bottomX,ballX,nx))registerHit('bottom',bottomX,nx);
    else ended=awardPoint('top');
  }else{
    ballX=nx;ballY=ny;if(eventEl)eventEl.textContent='FIRST TO 5';
  }
  draw();if(!ended)sendCurrentFrame();
}
function draw(){for(const p of pixels)p.className='pixel';for(let x=topX;x<topX+PADDLE;x++)pixels[x].className='pixel top';for(let x=bottomX;x<bottomX+PADDLE;x++)pixels[(H-1)*W+x].className='pixel bottom';pixels[ballY*W+ballX].className='pixel ball'}
function rgbFrame(){const f=Array.from({length:H},()=>Array.from({length:W},()=>[0,0,0]));for(let x=topX;x<topX+PADDLE;x++)f[0][x]=[0,170,255];for(let x=bottomX;x<bottomX+PADDLE;x++)f[H-1][x]=[255,120,0];f[ballY][ballX]=[255,255,255];return f}
function takeoverText(){if(topHuman&&bottomHuman)return ' · both paddles human';if(topHuman)return ' · top human / bottom AI';if(bottomHuman)return ' · top AI / bottom human';return ' · both paddles AI'}
async function pumpFrame(frame){
  sendBusy=true;
  try{
    const url=USE_QUEUE?`${CONTROL_API}/api/frame`:DIRECT_API;
    const headers={'Content-Type':'application/json'};
    if(USE_QUEUE&&controllerToken)headers.Authorization=`Bearer ${controllerToken}`;
    const r=await fetch(url,{method:'POST',mode:'cors',headers,body:JSON.stringify(frame),cache:'no-store'});
    if(!r.ok){const data=await r.json().catch(()=>({}));const err=new Error(data.error||`HTTP ${r.status}`);err.status=r.status;throw err}
    sendCount++;
    if(controllerState==='active'&&!matchOver)statusEl.textContent=`Controller active · first to 5${USE_QUEUE&&queueLength?` · ${queueLength} waiting`:''} · ${sendCount} frames sent${takeoverText()}.`;
    return true;
  }catch(e){
    statusEl.textContent=`Display send failed: ${e.message}.`;console.error('frame send failed',e);
    if(USE_QUEUE&&e.status===401){controllerToken='';setTimeout(joinQueue,0)}
    return false;
  }finally{
    sendBusy=false;
    if(pendingFrame&&controllerState==='active'&&!matchOver){const next=pendingFrame;pendingFrame=null;pumpFrame(next)}
  }
}
function sendCurrentFrame(force=false){
  if(controllerState!=='active'&&!force)return Promise.resolve(false);
  if(USE_QUEUE&&!controllerToken)return Promise.resolve(false);
  const frame=rgbFrame();
  if(sendBusy){pendingFrame=frame;return Promise.resolve(true)}
  return pumpFrame(frame);
}
function start(){if(controllerState!=='active'||running||matchOver)return;running=true;const ms=1000/Number(fpsEl.value);timer=setInterval(step,ms);statusEl.textContent=`You have the controller. First to 5 points${USE_QUEUE&&queueLength?` · ${queueLength} waiting`:''}.`;sendCurrentFrame()}
function pause(){if(controllerState!=='active'||matchOver)return;running=false;if(timer){clearInterval(timer);timer=null}statusEl.textContent='Paused, but this browser still holds the controller.'}
function restartTimer(){if(controllerState==='active'&&running&&!matchOver){clearInterval(timer);timer=setInterval(step,1000/Number(fpsEl.value))}}

document.getElementById('start').onclick=start;
document.getElementById('pause').onclick=pause;
document.getElementById('reset').onclick=()=>{if(controllerState!=='active')return;topHuman=false;bottomHuman=false;updateOwners();resetGame();start();sendCurrentFrame()};
fpsEl.onchange=restartTimer;
document.querySelectorAll('[data-move]').forEach(b=>{const [who,dir]=b.dataset.move.split('-');b.addEventListener('pointerdown',e=>{e.preventDefault();humanMove(who,dir==='left'?-1:1)})});
window.addEventListener('keydown',e=>{
  const k=e.key;
  if(['ArrowLeft','ArrowRight','a','A','d','D'].includes(k)){e.preventDefault();e.stopPropagation()}
  if(controllerState!=='active'||matchOver)return;
  if(k==='a'||k==='A')humanMove('top',-1);
  else if(k==='d'||k==='D')humanMove('top',1);
  else if(k==='ArrowLeft')humanMove('bottom',-1);
  else if(k==='ArrowRight')humanMove('bottom',1);
},{capture:true});
window.addEventListener('pagehide',()=>{
  if(USE_QUEUE&&controllerToken){
    fetch(`${CONTROL_API}/api/release`,{method:'POST',headers:{Authorization:`Bearer ${controllerToken}`},keepalive:true}).catch(()=>{});
  }
});

updateOwners();resetGame();setControlEnabled(false);showControllerState();
if(USE_QUEUE)joinQueue();else attemptAcquire(true);
