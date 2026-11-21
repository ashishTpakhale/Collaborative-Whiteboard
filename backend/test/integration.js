import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base=process.env.WS_URL||'ws://localhost:8080/ws';
const room=`test-${Date.now()}`, clients=[];
async function client(r=room){
  const ws=new WebSocket(`${base}?room=${r}`);clients.push(ws);ws.events=[];
  ws.on('message',b=>ws.events.push(JSON.parse(b)));
  ws.on('error',()=>{});
  await until(()=>ws.events.find(e=>e.type==='state'));
  return ws;
}
async function until(fn){const end=Date.now()+15000;while(Date.now()<end){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out waiting for event');}
const draw=id=>({type:'draw',id,x0:.1,y0:.2,x1:.8,y1:.9,color:'#123456',size:4,tool:'pen'});
try{
  const a=await client(), b=await client(), c=await client(), isolated=await client(`${room}-other`);
  const ids=new Set([a,b,c].map(w=>w.events.find(e=>e.type==='welcome').serverId));
  assert.equal(ids.size,3,'Expected three replicas; run full healthy Compose stack');
  a.send(JSON.stringify(draw('one')));
  for(const w of [a,b,c])await until(()=>w.events.find(e=>e.id==='one'&&e.type==='draw'));
  a.send(JSON.stringify(draw('one')));
  b.send(JSON.stringify(draw('two')));
  await until(()=>c.events.find(e=>e.id==='two'));
  const late=await client();let state=late.events.find(e=>e.type==='state');assert.equal(state.seq,2);assert.equal(state.events.length,2);
  assert.equal(isolated.events.filter(e=>e.type==='draw').length,0);
  a.send(JSON.stringify({type:'cursor',x:.3,y:.4}));await until(()=>b.events.find(e=>e.type==='cursor'));
  await new Promise(r=>setTimeout(r,11000));
  const checkpoint=await client();assert.equal(checkpoint.events.find(e=>e.type==='state').events.length,2);
  b.send(JSON.stringify({type:'clear',id:'clear-one'}));await until(()=>c.events.find(e=>e.type==='clear'));
  const cleared=await client();state=cleared.events.find(e=>e.type==='state');assert.equal(state.seq,3);assert.equal(state.events.filter(e=>e.type==='draw').length,0);
  // Simulate an uncertain acknowledgement: retry on a fresh connection.
  cleared.send(JSON.stringify(draw('two')));await until(()=>cleared.events.find(e=>e.type==='ack'&&e.id==='two'));
  cleared.send(JSON.stringify({type:'sync'}));await until(()=>cleared.events.filter(e=>e.type==='state').length===2);
  assert.equal(cleared.events.filter(e=>e.type==='state')[1].seq,3);
  console.log('PASS: three replicas, fan-out, isolation, cursors, deduplication, snapshots, late join and clear recovery');
}finally{for(const w of clients)w.terminate();}

