const W=9,H=17,PADDLE=3,API='https://sundai.willsarg.com/api/i/mellow-heron/frame';
const board=document.getElementById('board'),statusEl=document.getElementById('status'),fpsEl=document.getElementById('fps');
const topScoreEl=document.getElementById('topScore'),bottomScoreEl=document.getElementById('bottomScore');
const topOwnerEl=document.getElementById('topOwner'),bottomOwnerEl=document.getElementById('bottomOwner');
const pixels=[];
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=document.createElement('div');p.className='pixel';board.appendChild(p);pixels.push(p)}
let running=false,timer=null,topX=3,bottomX=3,ballX=4,ballY=8,dx=1,dy=1,topScore=0,bottomScore=0,sendBusy=false,pendingFrame=null,sendCount=0;
let topHuman=false,bottomHuman=false;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function resetBall(dir){ballX=4;ballY=8;dx=Math.random()<.5?-1:1;dy=dir??(Math.random()<.5?-1:1)}
function resetGame(){topX=bottomX=3;topScore=bottomScore=0;topScoreEl.textContent=0;bottomScoreEl.textContent=0;resetBall();draw()}
function updateOwners(){topOwnerEl.textContent=topHuman?'HUMAN':'AI';bottomOwnerEl.textContent=bottomHuman?'HUMAN':'AI';topOwnerEl.className=topHuman?'owner human':'owner';bottomOwnerEl.className=bottomHuman?'owner human':'owner'}
function move(which,delta){if(which==='top')topX=clamp(topX+delta,0,W-PADDLE);else bottomX=clamp(bottomX+delta,0,W-PADDLE);draw();if(running)sendCurrentFrame()}
function humanMove(which,delta){if(which==='top'){topHuman=true}else{bottomHuman=true}updateOwners();move(which,delta)}
function aiMove(which){const x=which==='top'?topX:bottomX,center=x+1,target=ballX;if(target<center)return clamp(x-1,0,W-PADDLE);if(target>center)return clamp(x+1,0,W-PADDLE);return x}
function bounceDx(hit,paddle,current){const c=paddle+1;return hit<c?-1:hit>c?1:(current||1)}
function step(){
  if(!topHuman&&(dy<0||Math.random()<.15))topX=aiMove('top');
  if(!bottomHuman&&(dy>0||Math.random()<.15))bottomX=aiMove('bottom');
  let nx=ballX+dx,ny=ballY+dy;
  if(nx<0||nx>=W){dx*=-1;nx=ballX+dx}
  if(ny<=0){if(nx>=topX&&nx<topX+PADDLE){dy=1;dx=bounceDx(nx,topX,dx);ballX=nx;ballY=1}else{bottomScore++;bottomScoreEl.textContent=bottomScore;resetBall(1)}}
  else if(ny>=H-1){if(nx>=bottomX&&nx<bottomX+PADDLE){dy=-1;dx=bounceDx(nx,bottomX,dx);ballX=nx;ballY=H-2}else{topScore++;topScoreEl.textContent=topScore;resetBall(-1)}}
  else{ballX=nx;ballY=ny}
  draw();sendCurrentFrame();
}
function draw(){for(const p of pixels)p.className='pixel';for(let x=topX;x<topX+PADDLE;x++)pixels[x].className='pixel top';for(let x=bottomX;x<bottomX+PADDLE;x++)pixels[(H-1)*W+x].className='pixel bottom';pixels[ballY*W+ballX].className='pixel ball'}
function rgbFrame(){const f=Array.from({length:H},()=>Array.from({length:W},()=>[0,0,0]));for(let x=topX;x<topX+PADDLE;x++)f[0][x]=[0,170,255];for(let x=bottomX;x<bottomX+PADDLE;x++)f[H-1][x]=[255,120,0];f[ballY][ballX]=[255,255,255];return f}
function takeoverText(){if(topHuman&&bottomHuman)return ' · both paddles human';if(topHuman)return ' · top human / bottom AI';if(bottomHuman)return ' · top AI / bottom human';return ' · both paddles AI'}
async function pumpFrame(frame){sendBusy=true;try{const r=await fetch(API,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(frame),cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);sendCount++;statusEl.textContent=`Live on mellow-heron · ${sendCount} frames sent${takeoverText()}.`}catch(e){statusEl.textContent=`Display send failed: ${e.message}. Local game is still running.`;console.error('mellow-heron frame send failed',e)}finally{sendBusy=false;if(pendingFrame){const next=pendingFrame;pendingFrame=null;pumpFrame(next)}}}
function sendCurrentFrame(){const frame=rgbFrame();if(sendBusy){pendingFrame=frame;return}pumpFrame(frame)}
function start(){if(running)return;running=true;const ms=1000/Number(fpsEl.value);timer=setInterval(step,ms);statusEl.textContent='Connecting to mellow-heron…';sendCurrentFrame()}
function pause(){running=false;if(timer){clearInterval(timer);timer=null}statusEl.textContent='Paused. Idle AI clip will resume on the building.'}
function restartTimer(){if(running){clearInterval(timer);timer=setInterval(step,1000/Number(fpsEl.value))}}
document.getElementById('start').onclick=start;document.getElementById('pause').onclick=pause;document.getElementById('reset').onclick=()=>{resetGame();sendCurrentFrame()};fpsEl.onchange=restartTimer;
document.querySelectorAll('[data-move]').forEach(b=>{const [who,dir]=b.dataset.move.split('-');b.addEventListener('pointerdown',e=>{e.preventDefault();humanMove(who,dir==='left'?-1:1)})});
window.addEventListener('keydown',e=>{
  const k=e.key;
  if(['ArrowLeft','ArrowRight','a','A','d','D'].includes(k)){e.preventDefault();e.stopPropagation()}
  if(k==='a'||k==='A')humanMove('top',-1);
  else if(k==='d'||k==='D')humanMove('top',1);
  else if(k==='ArrowLeft')humanMove('bottom',-1);
  else if(k==='ArrowRight')humanMove('bottom',1);
},{capture:true});
updateOwners();resetGame();start();
