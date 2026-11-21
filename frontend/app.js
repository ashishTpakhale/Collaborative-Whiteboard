const $=id=>document.getElementById(id);
const canvas=$('canvas'), ctx=canvas.getContext('2d');
let room=decodeURIComponent(location.pathname.split('/')[2]||'cs101');
if(!/^[A-Za-z0-9_-]{1,48}$/.test(room)) room='cs101';
history.replaceState(null,'',`/room/${room}`);$('room').value=room;
let socket, userId, ready=false, seq=0, attempt=0, tool='pen', previous=null, lastMove=0, lastCursor=0, syncing=false;
const pending=new Map(), cursors=new Map();
function render(e){
  if(e.type==='clear'){ctx.clearRect(0,0,1600,900);return;}
  if(e.type!=='draw')return;
  ctx.globalCompositeOperation=e.tool==='eraser'?'destination-out':'source-over';
  ctx.strokeStyle=e.color;ctx.lineWidth=e.size;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();ctx.moveTo(e.x0*1600,e.y0*900);ctx.lineTo(e.x1*1600,e.y1*900);ctx.stroke();
  if(e.x0===e.x1&&e.y0===e.y1){ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(e.x0*1600,e.y0*900,e.size/2,0,Math.PI*2);ctx.fill();}
  ctx.globalCompositeOperation='source-over';
}
function send(m){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(m));}
function sync(){if(!syncing&&ready){syncing=true;send({type:'sync'});}}
function connect(){
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?room=${encodeURIComponent(room)}`);
  socket.onmessage=({data})=>{
    const e=JSON.parse(data);
    if(e.type==='welcome'){userId=e.userId;$('badge').textContent=`Connected to: ${e.serverId}`;}
    else if(e.type==='state'){
      ctx.clearRect(0,0,1600,900);e.events.forEach(render);seq=e.seq;syncing=false;
      if(!ready){ready=true;attempt=0;$('offline').hidden=true;$('status').textContent='? Live collaboration';for(const m of pending.values())send(m);}
      $('metrics').textContent=`Room ${room} � Revision ${seq}`;
    } else if(e.type==='draw'||e.type==='clear'){
      pending.delete(e.id);
      if(e.seq<=seq)return;
      if(e.seq!==seq+1){sync();return;}
      render(e);seq=e.seq;$('metrics').textContent=`Room ${room} � Revision ${seq}`;
    } else if(e.type==='ack'){pending.delete(e.id);if(e.seq>seq)sync();}
    else if(e.type==='cursor'&&e.userId!==userId){
      let c=cursors.get(e.userId);
      if(!c){const el=document.createElement('div');el.className='cursor';const label=document.createElement('span');label.textContent=e.userId.slice(0,6);el.append('? ',label);$('cursors').append(el);c={el};cursors.set(e.userId,c);}
      c.el.style.left=`${e.x*100}%`;c.el.style.top=`${e.y*100}%`;c.at=Date.now();
    } else if(e.type==='leave'){cursors.get(e.userId)?.el.remove();cursors.delete(e.userId);}
    else if(e.type==='pong')$('status').textContent=`? Live � ${Math.max(0,Date.now()-e.at)} ms RTT`;
    else if(e.type==='error'){$('notice').textContent=e.message;pending.clear();}
  };
  socket.onclose=()=>{
    ready=false;syncing=false;previous=null;$('offline').hidden=false;$('offline').textContent='Reconnecting. Your board will be restored.';$('status').textContent='Reconnecting';$('badge').textContent='Connected to: -';
    for(const c of cursors.values())c.el.remove();cursors.clear();
    setTimeout(connect,Math.min(10000,500*2**attempt++)+Math.random()*400);
  };
  socket.onerror=()=>socket.close();
}
function operation(m){
  if(!ready)return;
  if(pending.size>=1000){$('notice').textContent='Waiting for the server to catch up.';return;}
  const event={...m,id:crypto.randomUUID(),roomId:room};pending.set(event.id,event);send(event);
}
function point(e){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
function stroke(p){if(previous)operation({type:'draw',x0:previous.x,y0:previous.y,x1:p.x,y1:p.y,color:$('color').value,size:Number($('size').value),tool});previous=p;}
canvas.onpointerdown=e=>{if(!ready||e.button!==0)return;canvas.setPointerCapture(e.pointerId);previous=point(e);stroke(previous);};
canvas.onpointermove=e=>{if(!ready)return;const p=point(e),now=performance.now();if(now-lastCursor>50){send({type:'cursor',...p});lastCursor=now;}if(previous&&now-lastMove>16){stroke(p);lastMove=now;}};
canvas.onpointerup=e=>{if(previous)stroke(point(e));previous=null;};canvas.onpointercancel=()=>previous=null;canvas.onlostpointercapture=()=>previous=null;
for(const t of ['pen','eraser'])$(t).onclick=()=>{tool=t;for(const k of ['pen','eraser']){$(k).classList.toggle('selected',k===t);$(k).setAttribute('aria-pressed',String(k===t));}};
$('size').oninput=()=> $('sizeValue').value=$('size').value;
$('clear').onclick=()=>{if(ready&&confirm('Clear this board for everyone?'))operation({type:'clear'});};
$('roomForm').onsubmit=e=>{e.preventDefault();location.href=`/room/${encodeURIComponent($('room').value)}`;};
$('share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$('notice').textContent='Room link copied.';}catch{$('notice').textContent=location.href;}};
setInterval(()=>{if(ready){send({type:'ping',at:Date.now()});sync();}for(const [id,c]of cursors)if(Date.now()-c.at>5000){c.el.remove();cursors.delete(id);}},3000);
connect();

