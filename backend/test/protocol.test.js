import test from 'node:test';
import assert from 'node:assert/strict';
import {validRoom,validate} from '../src/protocol.js';
test('rooms reject wildcard and Redis namespace injection',()=>{for(const r of ['','*','a:b','../x','a'.repeat(49)])assert.equal(validRoom(r),false);assert.ok(validRoom('cs101-A'));});
test('draw validation rejects invalid numbers and strips identity',()=>{
  const m={type:'draw',id:'abc',x0:0,y0:0,x1:1,y1:1,color:'#123abc',size:4,tool:'pen',userId:'forged'};
  assert.equal(validate(m).userId,undefined);
  for(const change of [{x0:NaN},{y1:1.01},{size:0},{color:'red'},{tool:'bad'}])assert.throws(()=>validate({...m,...change}));
});

