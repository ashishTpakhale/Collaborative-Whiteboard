export const validRoom = room => typeof room === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(room);
const coord = x => Number.isFinite(x) && x >= 0 && x <= 1;
export function validate(m) {
  if (!m || typeof m !== 'object') throw Error('Invalid message');
  if (m.type === 'cursor' && coord(m.x) && coord(m.y)) return {type:'cursor', x:m.x, y:m.y};
  if (typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.id)) throw Error('Invalid event ID');
  if (m.type === 'clear') return {type:'clear', id:m.id};
  if (m.type !== 'draw' || ![m.x0,m.y0,m.x1,m.y1].every(coord) ||
      !/^#[0-9a-fA-F]{6}$/.test(m.color) || !Number.isFinite(m.size) || m.size < 1 || m.size > 40 ||
      !['pen','eraser'].includes(m.tool)) throw Error('Invalid drawing');
  return {type:'draw', id:m.id, x0:m.x0,y0:m.y0,x1:m.x1,y1:m.y1,color:m.color,size:m.size,tool:m.tool};
}

