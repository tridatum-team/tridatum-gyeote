import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.GYEOTE_TEST_URL||'http://127.0.0.1:8901';
const code=(await readFile(new URL('../data/access-code.txt',import.meta.url),'utf8')).trim();
function client(){let cookie='';return async(path,method='GET',body,extra={})=>{const r=await fetch(base+path,{method,headers:{...extra,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};}
test('Cloud worker requires access code; cookie and API privacy headers',async()=>{
 const c=client();assert.equal((await c('/api/session','POST')).status,401);
 const r=await c('/api/session','POST',{access_code:code});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await c('/api/rooms')).status,200);
});
test('Accounts cannot read rooms; forged origins rejected',async()=>{
 const a=client(),b=client();await a('/api/session','POST',{access_code:code});await b('/api/session','POST',{access_code:code});
 const room=(await (await a('/api/rooms')).json())[0].id;
 assert.equal((await b(`/api/rooms/${room}/turns`)).status,404);
 assert.equal((await a('/api/rooms','POST',{}, {Origin:'https://untrusted.example'})).status,403);
});
test('Invalid uploads and profiles rejected before any paid AI call',async()=>{
 const c=client();await c('/api/session','POST',{access_code:code});const room=(await(await c('/api/rooms')).json())[0].id;
 assert.equal((await c('/api/profile','PUT',{name:'나',mode:'unknown'})).status,422);
 assert.equal((await c(`/api/rooms/${room}/turns`,'POST',{request_id:crypto.randomUUID(),text:''})).status,422);
 assert.equal((await c(`/api/rooms/${room}/turns`,'POST',{request_id:crypto.randomUUID(),text:'사진',image:'%%%bad',image_type:'image/jpeg'})).status,422);
});
test('Family groups: create, invite, join, notes and reads without paid AI calls',async()=>{
 const a=client(),b=client(),outsider=client();
 for(const c of [a,b,outsider])await c('/api/session','POST',{access_code:code});
 const g=await(await a('/api/groups','POST',{title:'테스트 가족'})).json();
 assert.ok(g.id&&g.room);
 const inv=await(await a(`/api/groups/${g.id}/invite`,'POST',{})).json();
 assert.match(inv.code,/^\d{8}$/);
 const joined=await(await b('/api/groups/join','POST',{code:inv.code})).json();
 assert.equal(joined.room,g.room);
 assert.equal((await outsider('/api/groups/join','POST',{code:inv.code})).status,400);
 assert.equal((await outsider(`/api/rooms/${g.room}/turns`)).status,404);
 assert.equal((await outsider(`/api/groups/${g.id}/invite`,'POST',{})).status,404);
 const groups=await(await b('/api/groups')).json();
 assert.equal(groups[0].members.length,2);
 const noteId=crypto.randomUUID();
 const note=await(await b(`/api/rooms/${g.room}/turns`,'POST',{request_id:noteId,text:'저 지금 들어왔어요',kind:'note'})).json();
 assert.equal(note.kind,'note');assert.equal(note.status,'done');assert.equal(note.answer,null);
 const seenByA=(await(await a(`/api/rooms/${g.room}/turns`)).json()).find(t=>t.id===noteId);
 assert.ok(seenByA&&seenByA.mine===false&&typeof seenByA.sender==='string');
 assert.equal(seenByA.my_read,false);
 assert.equal((await a(`/api/turns/${noteId}/read`,'POST',{})).status,200);
 const seenByB=(await(await b(`/api/rooms/${g.room}/turns`)).json()).find(t=>t.id===noteId);
 assert.equal(seenByB.reads.length,1);assert.equal(seenByB.my_read,true);
 const personal=(await(await a('/api/rooms')).json()).find(r=>!r.gid);
 assert.equal((await a(`/api/rooms/${personal.id}/turns`,'POST',{request_id:crypto.randomUUID(),text:'노트',kind:'note'})).status,422);
 assert.equal((await a(`/api/turns/${noteId}/read`,'POST',{})).status,200);
 // 나가기: b가 나가면 b에게서 방이 사라지고, 마지막 인원 a까지 나가면 방과 대화가 삭제된다
 assert.equal((await b(`/api/groups/${g.id}/leave`,'POST',{})).status,200);
 assert.ok(!(await(await b('/api/rooms')).json()).some(r=>r.id===g.room));
 assert.equal((await b(`/api/rooms/${g.room}/turns`)).status,404);
 assert.ok((await(await a('/api/rooms')).json()).some(r=>r.id===g.room));
 assert.equal((await a(`/api/groups/${g.id}/leave`,'POST',{})).status,200);
 assert.equal((await a(`/api/rooms/${g.room}/turns`)).status,404);
 assert.equal((await a('/api/groups')).status,200);
 assert.ok(!(await(await a('/api/groups')).json()).some(x=>x.id===g.id));
});
test('Install assets exist and advertise standalone mode',async()=>{
 const manifest=await (await fetch(base+'/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons){const r=await fetch(base+icon.src);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/image\/png/);}
 const sw=await(await fetch(base+'/sw.js')).text();assert.match(sw,/pathname.startsWith\('\/api\/'\)/);
});
