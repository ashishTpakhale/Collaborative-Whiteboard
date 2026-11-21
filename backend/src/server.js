import express from 'express';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import {createClient} from 'redis';
import {validate, validRoom} from './protocol.js';
import {keys, APPEND, READ, SNAPSHOT} from './store.js';

const serverId = process.env.SERVER_ID || 'server-local';
const redis = createClient({url:process.env.REDIS_URL || 'redis://localhost:6379', disableOfflineQueue:true});
const sub = redis.duplicate();
const rooms = new Map();
let subscribed = false;
for (const c of [redis,sub]) c.on('error', e=>console.error('Redis:',e.message));
sub.on('reconnecting',()=>{subscribed=false; for(const ws of wss.clients) ws.close(1012,'Broker reconnecting');});
const app = express();
app.get('/health',(_,res)=>res.status(redis.isReady && subscribed ? 200:503).json({serverId,clients:wss.clients.size,ready:redis.isReady && subscribed}));
const server = createServer(app);
const wss = new WebSocketServer({server,path:'/ws',maxPayload:2048});
function send(ws,msg) {
  if(ws.readyState !== WebSocket.OPEN) return;
  if(ws.bufferedAmount > 8*1024*1024) return ws.close(1013,'Slow consumer; reconnect');
  ws.send(JSON.stringify(msg));
}
async function recover(ws) {
  if(ws.syncing) return;
  ws.syncing=true;
  ws.buffer=[];
  try {
    const [seq,snapshot,tail] = await redis.eval(READ,{keys:keys(ws.room),arguments:[]});
    send(ws,{type:'state',seq:Number(seq),events:[...snapshot,...tail].map(JSON.parse)});
    for(const event of ws.buffer) if(!event.seq || event.seq>Number(seq)) send(ws,event);
  } finally { ws.syncing=false; ws.buffer=[]; }
}
wss.on('connection',(ws,req)=>{
  const room = new URL(req.url,'http://local').searchParams.get('room');
  if(!validRoom(room)) return ws.close(1008,'Invalid room');
  if(!redis.isReady || !subscribed) return ws.close(1013,'Broker unavailable');
  ws.room=room; ws.userId=randomUUID(); ws.alive=true; ws.syncing=false;
  if(!rooms.has(room)) rooms.set(room,new Set());
  rooms.get(room).add(ws);
  send(ws,{type:'welcome',serverId,userId:ws.userId,roomId:room});
  let chain=recover(ws);
  let windowStart=Date.now(), count=0;
  ws.on('pong',()=>ws.alive=true);
  ws.on('message',raw=>{
    if(Date.now()-windowStart>1000){windowStart=Date.now();count=0;}
    if(++count>180) return ws.close(1008,'Rate limit');
    chain=chain.then(async()=>{
      let m;
      try {m=JSON.parse(raw);} catch {throw Error('Invalid JSON');}
      if(m.type==='sync') return recover(ws);
      if(m.type==='ping') return send(ws,{type:'pong',at:m.at});
      const event={...validate(m),roomId:room,userId:ws.userId,serverId,at:Date.now()};
      if(event.type==='cursor') {
        if(Date.now()-(ws.lastCursor||0)<40) return;
        ws.lastCursor=Date.now();
        return redis.publish(`whiteboard:${room}`,JSON.stringify(event));
      }
      const seq=await redis.eval(APPEND,{keys:keys(room),arguments:[event.id,JSON.stringify(event),`whiteboard:${room}`]});
      send(ws,{type:'ack',id:event.id,seq:Number(seq)});
    }).catch(e=>{send(ws,{type:'error',message:e.message});ws.close(1013,'Operation failed');});
  });
  chain=chain.catch(()=>ws.close(1013,'Recovery failed'));
  ws.on('close',()=>{
    rooms.get(room)?.delete(ws);
    if(!rooms.get(room)?.size) rooms.delete(room);
    redis.publish(`whiteboard:${room}`,JSON.stringify({type:'leave',userId:ws.userId,roomId:room})).catch(()=>{});
  });
  ws.on('error',()=>{});
});
await redis.connect();
await sub.connect();
await sub.pSubscribe('whiteboard:*',(raw)=>{
  const event=JSON.parse(raw);
  for(const ws of rooms.get(event.roomId)||[]) {
    if(ws.syncing) {
      if(ws.buffer.length>=22000) ws.close(1013,'Recovery overflow');
      else ws.buffer.push(event);
    } else send(ws,event);
  }
});
subscribed=true;
sub.on('ready',()=>{subscribed=true;});
// Only rooms with local clients need checkpointing; Lua makes concurrent workers safe.
let checkpointing=false;
const snapshots=setInterval(async()=>{
  if(checkpointing || !redis.isReady) return;
  checkpointing=true;
  try {for(const room of rooms.keys()) await redis.eval(SNAPSHOT,{keys:keys(room),arguments:[]});}
  catch(e){console.error('Snapshot:',e.message);} finally {checkpointing=false;}
},10000);
const heartbeat=setInterval(()=>{
  for(const ws of wss.clients){if(!ws.alive) ws.terminate();else {ws.alive=false;ws.ping();}}
},20000);
server.listen(Number(process.env.PORT||3000),()=>console.log(`${serverId} listening`));
async function shutdown(){clearInterval(snapshots);clearInterval(heartbeat);for(const ws of wss.clients) ws.close(1012,'Restart');server.close();await Promise.allSettled([redis.quit(),sub.quit()]);setTimeout(()=>process.exit(0),500).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

