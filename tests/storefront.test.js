'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const Stripe=require('stripe');
const {MongoMemoryReplSet}=require('mongodb-memory-server-core');
const {createApp}=require('../server');
const {openDatabase}=require('../backend/config/database');
const secret='whsec_temazon_test_secret';
const customer={name:'Test Shopper',email:'test@example.com',address:'123 Example Street',city:'Toronto',postal:'A1A 1A1'};
let mongo;
before(async()=>{
 mongo=await MongoMemoryReplSet.create({binary:{downloadDir:path.join(__dirname,'..','.cache','mongodb')},replSet:{count:1}});
}, {timeout:300000});
after(async()=>{await mongo?.stop();});
function fakeStripe() {
 const remote=new Map();const keys=new Map();const sdk=new Stripe('sk_test_fake');let creates=0;let loseNextResponse=false;
 const clone=value=>structuredClone(value);
 return {webhooks:sdk.webhooks,get creates(){return creates;},loseNextResponse(){loseNextResponse=true;},
  pay(id){const session=remote.get(id);session.status='complete';session.payment_status='paid';session.payment_intent='pi_test_'+id;},
  session(id){return remote.get(id);},
  checkout:{sessions:{
   async create(params,options) {
    if(keys.has(options.idempotencyKey)) return clone(remote.get(keys.get(options.idempotencyKey)));
    creates++; const id='cs_test_'+randomUUID();
    const session={id,status:'open',payment_status:'unpaid',currency:'usd',payment_intent:null,url:'https://checkout.stripe.com/c/pay/'+id,
      amount_total:params.line_items.reduce((sum,line)=>sum+line.price_data.unit_amount*line.quantity,0)+params.shipping_options[0].shipping_rate_data.fixed_amount.amount,
      metadata:params.metadata,client_reference_id:params.client_reference_id,expires_at:params.expires_at};
    remote.set(id,session);keys.set(options.idempotencyKey,id);
    if(loseNextResponse){loseNextResponse=false;throw new Error('Simulated network timeout after Stripe session creation');}
    return clone(session);
   },
   async retrieve(id){if(!remote.has(id)) throw new Error('Unknown Stripe session');return clone(remote.get(id));},
   async expire(id){const session=remote.get(id);if(session.status!=='open') throw new Error('Not open');session.status='expired';return clone(session);}
  }}
 };
}
async function fixture(t,{databaseName='temazon_test_'+randomUUID().replaceAll('-',''),stripe=fakeStripe(),webhookSecret=secret,jwtSecret='test-jwt-secret-at-least-32-bytes-long',firebaseAuth=null,firebaseConfig=null,cache,cloudinary=null}={}) {
 const app=await createApp({mongoUri:mongo.getUri(),databaseName,stripe,webhookSecret,jwtSecret,firebaseAuth,firebaseConfig,cache,cloudinary});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 let closed=false;
 const close=async()=>{if(closed)return;closed=true;await new Promise(resolve=>server.close(resolve));await app.locals.close();};t.after(close);
 function client(initialCookie='') {
  const jar=new Map(initialCookie.split(';').map(item=>item.trim()).filter(Boolean).map(item=>{const index=item.indexOf('=');return [item.slice(0,index),item.slice(index+1)];}));
  const cookies=()=>[...jar].map(([key,value])=>key+'='+value).join('; ');
  return {get cookie(){return cookies();},async request(route,method='GET',body,headers={}) {
   const response=await fetch(base+route,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-Temazon-Request':'1',Cookie:cookies(),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
   for(const entry of response.headers.getSetCookie()) {const pair=entry.split(';')[0];const index=pair.indexOf('=');const key=pair.slice(0,index);const value=pair.slice(index+1);if(value)jar.set(key,value);else jar.delete(key);}
   const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
   return {status:response.status,data,headers:response.headers};
  }};
 }
 async function webhook(stripeId,type='checkout.session.completed',valid=true) {
  const payload=JSON.stringify({id:'evt_'+randomUUID(),type,data:{object:{id:stripeId}}});
  const signature=stripe.webhooks.generateTestHeaderString({payload,secret:valid?secret:'wrong'});
  return fetch(base+'/api/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature},body:payload});
 }
 async function checkout(c,key=randomUUID()) {
  const response=await c.request('/api/checkout/sessions','POST',{customer,totalCents:1},{'Idempotency-Key':key});
  assert.equal(response.status,201,JSON.stringify(response.data));
  const order=await app.locals.store.orders.findOne({_id:response.data.orderId});return {response,order};
 }
 return {app,client,close,base,stripe,webhook,checkout,databaseName};
}
test('configuration requires MongoDB without falling back to SQLite',async()=>{
 await assert.rejects(openDatabase({uri:''}),/MONGODB_URI is required/);
});
test('static pages, catalogue, filters and health are available',async t=>{
 const f=await fixture(t);const c=f.client();
 for(const url of ['/','/cart.html','/checkout.html','/product.html?id=1','/app.js','/checkout.js','/style.css','/account.html','/account.js','/admin.html','/admin.js','/common.js']) assert.equal((await c.request(url)).status,200,url);
 assert.equal((await c.request('/api/health')).data.database,'mongodb');
 assert.deepEqual((await c.request('/api/products?category=Electronics&sort=price-low')).data.products.map(p=>p.id),[8,1]);
 assert.equal((await c.request('/api/products?q=backpack')).data.products.length,1);
 assert.equal((await c.request('/api/products/1')).data.product.price,79.99);
 for(const [url,status] of [['/api/products/999',404],['/api/products/NaN',400],['/api/products?sort=bad',400],['/api/missing',404]]) assert.equal((await c.request(url)).status,status);
});
test('server owns prices, shipping, quantities and validation',async t=>{
 const f=await fixture(t);const c=f.client();const empty=await c.request('/api/cart');
 assert.equal(empty.data.totalCents,0);assert.match(empty.headers.get('set-cookie'),/HttpOnly/i);assert.match(empty.headers.get('set-cookie'),/SameSite=Lax/i);
 for(const quantity of [0,-1,1.5,'2',100,null]) assert.equal((await c.request('/api/cart/items','POST',{id:1,quantity})).status,400);
 assert.equal((await c.request('/api/cart/items','POST',{id:999,quantity:1})).status,404);
 let response=await c.request('/api/cart/items','POST',{id:6,quantity:1,price:0});
 assert.equal(response.data.subtotalCents,2999);assert.equal(response.data.shippingCents,599);
 response=await c.request('/api/cart/items/6','PATCH',{quantity:2});assert.equal(response.data.totalCents,5998);assert.equal(response.data.shippingCents,0);
 await c.request('/api/cart/items/6','DELETE',{});assert.equal((await c.request('/api/cart')).data.items.length,0);
 assert.equal((await c.request('/api/cart/items/6','PATCH',{quantity:1})).status,404);
 await c.request('/api/cart/items','POST',{id:1,quantity:99});
 assert.equal((await c.request('/api/cart/items','POST',{id:1,quantity:1})).status,409);
 assert.equal((await c.request('/api/cart/items','POST',{id:1,quantity:1,padding:'x'.repeat(17000)})).status,413);
});
test('checkout reserves inventory; signed paid webhook confirms once and isolates guests',async t=>{
 const f=await fixture(t);const a=f.client();const b=f.client();
 await a.request('/api/cart');await b.request('/api/cart');await a.request('/api/cart/items','POST',{id:6,quantity:2});
 assert.equal((await b.request('/api/cart')).data.items.length,0);
 const key=randomUUID();const {order}=await f.checkout(a,key);
 assert.equal(order.totalCents,5998);assert.equal(order.status,'awaiting-payment');assert.equal((await a.request('/api/products/6')).data.product.stock,98);
 assert.equal((await a.request('/api/cart')).data.items.length,1);
 assert.equal((await a.request('/api/cart/items','POST',{id:1,quantity:1})).status,409);
 assert.equal((await a.request('/api/checkout/sessions','POST',{customer},{'Idempotency-Key':key})).data.orderId,order._id);
 assert.equal(f.stripe.creates,1);
 assert.equal((await b.request('/api/orders/'+order._id)).status,404);
 assert.equal((await b.request('/api/checkout/'+order._id)).status,404);
 assert.equal((await f.webhook(order.stripeSessionId,'checkout.session.completed',false)).status,400);
 assert.equal((await a.request('/api/orders/'+order._id)).data.order.status,'awaiting-payment');
 f.stripe.pay(order.stripeSessionId);
 assert.equal((await f.webhook(order.stripeSessionId)).status,200);
 assert.equal((await f.webhook(order.stripeSessionId)).status,200);
 assert.equal((await a.request('/api/orders/'+order._id)).data.order.status,'paid');
 assert.equal((await a.request('/api/cart')).data.items.length,0);
 assert.equal((await a.request('/api/products/6')).data.product.stock,98);
});
test('unpaid completion never marks an order paid; expiration releases stock once',async t=>{
 const f=await fixture(t);const c=f.client();await c.request('/api/cart/items','POST',{id:1,quantity:2});const {order}=await f.checkout(c);
 await f.webhook(order.stripeSessionId);
 assert.equal((await c.request('/api/orders/'+order._id)).data.order.status,'awaiting-payment');
 f.stripe.session(order.stripeSessionId).status='expired';
 await f.webhook(order.stripeSessionId,'checkout.session.expired');await f.webhook(order.stripeSessionId,'checkout.session.expired');
 assert.equal((await c.request('/api/orders/'+order._id)).data.order.status,'expired');
 assert.equal((await c.request('/api/products/1')).data.product.stock,100);
 assert.equal((await c.request('/api/cart')).data.items[0].quantity,2);
 assert.equal((await c.request('/api/cart')).data.checkout,null);
});
test('cancellation checks Stripe and never releases stock after successful payment',async t=>{
 const f=await fixture(t);const c=f.client();await c.request('/api/cart/items','POST',{id:1,quantity:1});
 let {order}=await f.checkout(c);
 assert.equal((await c.request('/api/checkout/'+order._id+'/cancel','POST',{})).data.order.status,'expired');
 assert.equal((await c.request('/api/products/1')).data.product.stock,100);
 ({order}=await f.checkout(c));f.stripe.pay(order.stripeSessionId);
 assert.equal((await c.request('/api/checkout/'+order._id+'/cancel','POST',{})).data.order.status,'paid');
 assert.equal((await c.request('/api/products/1')).data.product.stock,99);
});
test('stock conflict rolls back every reservation and blocks checkout bypass',async t=>{
 const f=await fixture(t);const a=f.client();const b=f.client();await a.request('/api/cart');await b.request('/api/cart');
 await a.request('/api/cart/items','POST',{id:1,quantity:1});await a.request('/api/cart/items','POST',{id:6,quantity:2});
 await b.request('/api/cart/items','POST',{id:6,quantity:99});await f.checkout(b);
 const response=await a.request('/api/checkout/sessions','POST',{customer},{'Idempotency-Key':randomUUID()});assert.equal(response.status,409);
 assert.equal((await a.request('/api/products/1')).data.product.stock,100);
 assert.equal((await a.request('/api/orders')).data.orders.length,0);
 assert.equal((await a.request('/api/orders','POST',{customer})).status,410);
});
test('concurrent cart updates and checkouts do not lose items or double-reserve',async t=>{
 const f=await fixture(t);const c=f.client();await c.request('/api/cart');
 const adds=await Promise.all([c.request('/api/cart/items','POST',{id:1,quantity:1}),c.request('/api/cart/items','POST',{id:1,quantity:1})]);
 assert.ok(adds.every(r=>r.status===201));assert.equal((await c.request('/api/cart')).data.items[0].quantity,2);
 const key=randomUUID();const results=await Promise.all([c.request('/api/checkout/sessions','POST',{customer},{'Idempotency-Key':key}),c.request('/api/checkout/sessions','POST',{customer},{'Idempotency-Key':key})]);
 assert.ok(results.every(r=>r.status===201),JSON.stringify(results));assert.equal(results[0].data.orderId,results[1].data.orderId);
 assert.equal(f.stripe.creates,1);assert.equal((await c.request('/api/products/1')).data.product.stock,98);
});
test('restart and Stripe timeout recovery preserve reservations without duplicate sessions',async t=>{
 const f=await fixture(t);const c=f.client();await c.request('/api/cart/items','POST',{id:2,quantity:1});f.stripe.loseNextResponse();
 assert.equal((await c.request('/api/checkout/sessions','POST',{customer},{'Idempotency-Key':randomUUID()})).status,500);
 const checkout=(await c.request('/api/cart')).data.checkout;const cookie=c.cookie;await f.close();
 const next=await fixture(t,{databaseName:f.databaseName,stripe:f.stripe});const restored=next.client(cookie);
 const resumed=await restored.request('/api/checkout/'+checkout.id+'/resume','POST',{});assert.equal(resumed.status,200);
 assert.equal(f.stripe.creates,1);assert.equal((await restored.request('/api/products/2')).data.product.stock,99);
 const persisted=await next.app.locals.store.orders.findOne({_id:checkout.id});next.stripe.pay(persisted.stripeSessionId);
 assert.equal((await restored.request('/api/checkout/'+checkout.id)).data.order.status,'paid');
});
test('payment amount mismatch is rejected and guest expiry is enforced',async t=>{
 const f=await fixture(t);const c=f.client();await c.request('/api/cart/items','POST',{id:1,quantity:1});const {order}=await f.checkout(c);
 f.stripe.pay(order.stripeSessionId);f.stripe.session(order.stripeSessionId).amount_total=1;
 assert.equal((await f.webhook(order.stripeSessionId)).status,409);
 assert.equal((await c.request('/api/orders/'+order._id)).data.order.status,'awaiting-payment');
 const oldCookie=c.cookie;await f.app.locals.store.sessions.updateMany({},{$set:{expiresAt:new Date(0)}});
 assert.equal((await c.request('/api/cart')).data.items.length,0);assert.notEqual(c.cookie,oldCookie);
 assert.equal((await c.request('/api/orders/'+order._id)).status,404);
});
test('invalid checkout data and cross-site requests cannot create orders',async t=>{
 const f=await fixture(t);const c=f.client();const headers={'Idempotency-Key':randomUUID()};
 assert.equal((await c.request('/api/checkout/sessions','POST',{customer},headers)).status,400);
 await c.request('/api/cart/items','POST',{id:1,quantity:1});
 for(const invalid of [{},{...customer,name:' '},{...customer,email:'bad'},{...customer,postal:'x'.repeat(21)}]) assert.equal((await c.request('/api/checkout/sessions','POST',{customer:invalid},headers)).status,400);
 assert.equal((await c.request('/api/checkout/sessions','POST',{customer})).status,400);
 assert.equal((await c.request('/api/cart/items','POST',{id:1,quantity:1},{'Sec-Fetch-Site':'cross-site'})).status,403);
 const malformed=await fetch(f.base+'/api/cart/items',{method:'POST',headers:{'Content-Type':'application/json','X-Temazon-Request':'1'},body:'{bad'});assert.equal(malformed.status,400);
 const unsigned=await fetch(f.base+'/api/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(unsigned.status,400);
 assert.equal((await c.request('/api/orders')).data.orders.length,0);
});
test('frontend queues cart updates and redirects to Stripe without claiming payment',async t=>{
 const vm=require('node:vm');const {readFileSync}=require('node:fs');const f=await fixture(t);
 const nodes=new Map();function element(){return {innerHTML:'',textContent:'',hidden:true,disabled:false,listeners:{},classList:{add(){},remove(){}},addEventListener(name,fn){this.listeners[name]=fn;},focus(){},scrollIntoView(){}};}
 for(const id of ['cart-content','cart-count','toast','checkout-section','checkout-form','checkout-btn']) nodes.set(id,element());
 const submit=element();nodes.get('checkout-form').querySelector=()=>submit;
 let cookie='';let redirect='';let posts=0;
 const context=vm.createContext({Intl,URLSearchParams,location:{search:''},crypto:{randomUUID},setTimeout:()=>0,clearTimeout(){},
  FormData:class{*[Symbol.iterator](){yield* Object.entries(customer);}},
  document:{getElementById:id=>nodes.get(id)||null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},
  window:{addEventListener(){},location:{assign(url){redirect=url;}}},
  fetch:async(url,options)=>{if(url==='/api/checkout/sessions')posts++;const response=await fetch(f.base+url,{...options,headers:{...options.headers,Cookie:cookie}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;}});
 vm.runInContext(readFileSync('public/app.js','utf8').replace(/initialize\(\);\s*$/,'globalThis.boot=initialize();'),context);await context.boot;
 assert.equal(vm.runInContext('ready',context),true);
 assert.equal(vm.runInContext("escapeHTML('<img src=x onerror=alert(1)>')",context),'&lt;img src=x onerror=alert(1)&gt;');
 await Promise.all([vm.runInContext('addToCart(6)',context),vm.runInContext('addToCart(6)',context)]);
 assert.equal(vm.runInContext('totals().total',context),59.98);
 const handler=nodes.get('checkout-form').listeners.submit;const event={preventDefault(){},currentTarget:nodes.get('checkout-form')};
 await Promise.all([handler(event),handler(event)]);assert.equal(posts,1);assert.match(redirect,/^https:\/\/checkout\.stripe\.com\//);
 assert.equal(vm.runInContext('cart.length',context),1);
});

const password='a-strong-test-password-123';
async function register(c,email='shopper@example.com') {
 const result=await c.request('/api/auth/register','POST',{name:'Test Account',email,password,role:'admin'});
 assert.equal(result.status,201,JSON.stringify(result.data));return result.data.user;
}
async function adminClient(f) {
 const c=f.client();const user=await register(c,'admin@example.com');await f.app.locals.store.db.collection('users').updateOne({_id:user.id},{$set:{role:'admin'}});return c;
}
function testCloudinary() {return {calls:0,async upload(buffer){this.calls++;return {secure_url:'https://res.cloudinary.com/test/image/upload/test.png',public_id:'temazon/test'};},async destroy(){}};}
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2z8AAAAASUVORK5CYII=','base64');
async function upload(c,buffer=pixel,name='product.png') {
 const data=new FormData();data.append('image',new Blob([buffer],{type:'image/png'}),name);return c.request('/api/admin/images','POST',data);
}
function fakeRedis() {
 const values=new Map();return {isReady:true,gets:0,sets:0,async get(key){this.gets++;return values.get(key)||null;},async set(key,value,options){assert.equal(options.EX,30);this.sets++;values.set(key,value);},async incr(key){const next=Number(values.get(key)||0)+1;values.set(key,String(next));return next;}};
}
test('bcrypt registration, cookie JWTs, live roles and logout revocation are enforced',async t=>{
 const f=await fixture(t);const c=f.client();
 assert.equal((await c.request('/api/admin/overview')).status,401);
 const user=await register(c);assert.equal(user.role,'customer');assert.ok(user.createdAt);assert.equal(user.passwordHash,undefined);
 const stored=await f.app.locals.store.db.collection('users').findOne({_id:user.id});assert.match(stored.passwordHash,/^\$2[aby]\$12\$/);assert.notEqual(stored.passwordHash,password);
 assert.equal((await c.request('/api/auth/me')).data.user.id,user.id);
 assert.equal((await c.request('/api/admin/overview')).status,403);
 await f.app.locals.store.db.collection('users').updateOne({_id:user.id},{$set:{role:'admin'}});
 assert.equal((await c.request('/api/admin/overview')).status,200);
 assert.equal((await c.request('/api/auth/me')).data.user.role,'admin');
 const stolen=c.cookie;await c.request('/api/auth/logout','POST',{});
 assert.equal((await f.client(stolen).request('/api/admin/overview')).status,401);
 assert.equal((await c.request('/api/auth/me')).data.user,null);
 assert.equal((await c.request('/api/auth/login','POST',{email:user.email,password:'incorrect'})).status,401);
 assert.equal((await c.request('/api/auth/login','POST',{email:user.email,password})).status,200);
});
test('password validation, token forgery/expiry and password-change revocation',async t=>{
 const f=await fixture(t);const c=f.client();
 for(const value of ['short','a'.repeat(73),'\u00e9'.repeat(40)]) assert.equal((await c.request('/api/auth/register','POST',{name:'Test',email:'invalid@example.com',password:value})).status,400);
 const user=await register(c);const stolen=c.cookie;
 const jwt=require('jsonwebtoken');
 for(const token of [jwt.sign({sub:user.id,role:'admin'},'different-test-secret-at-least-32-bytes'),jwt.sign({sub:user.id,jti:randomUUID()},'test-jwt-secret-at-least-32-bytes-long',{algorithm:'HS256',issuer:'temazon',audience:'temazon-web',expiresIn:-1})]) assert.equal((await f.client('temazon_auth='+token).request('/api/admin/overview')).status,401);
 assert.equal((await c.request('/api/auth/password','POST',{currentPassword:'bad',newPassword:'another-strong-password'})).status,401);
 assert.equal((await c.request('/api/auth/password','POST',{currentPassword:password,newPassword:'another-strong-password'})).status,200);
 assert.equal((await f.client(stolen).request('/api/auth/me')).data.user,null);
 assert.equal((await c.request('/api/auth/login','POST',{email:user.email,password})).status,401);
 assert.equal((await c.request('/api/auth/login','POST',{email:user.email,password:'another-strong-password'})).status,200);
});
test('sign-in rotates the guest cart and account order history stays private across browsers',async t=>{
 const f=await fixture(t);const c=f.client();await c.request('/api/cart/items','POST',{id:1,quantity:2});const oldGuest=c.cookie;
 const user=await register(c);
 assert.equal((await c.request('/api/cart')).data.items[0].quantity,2);
 assert.equal((await f.client(oldGuest).request('/api/cart')).data.items.length,0);
 const {order}=await f.checkout(c);f.stripe.pay(order.stripeSessionId);await f.webhook(order.stripeSessionId);
 const next=f.client();await next.request('/api/auth/login','POST',{email:user.email,password});
 assert.equal((await next.request('/api/orders')).data.orders[0].id,order._id);
 assert.equal((await next.request('/api/checkout/'+order._id)).data.order.status,'paid');
 const other=f.client();await register(other,'another@example.com');
 assert.equal((await other.request('/api/orders/'+order._id)).status,404);
 assert.equal((await other.request('/api/checkout/'+order._id+'/cancel','POST',{})).status,404);
 const authenticatedCookie=c.cookie;await c.request('/api/auth/logout','POST',{});
 assert.equal((await f.client(authenticatedCookie).request('/api/orders/'+order._id)).status,404);
});
test('Firebase Google tokens are verified and existing password accounts require explicit linking',async t=>{
 const verifier={async verifyIdToken(value,revoked){assert.equal(revoked,true);if(value==='bad')throw new Error('revoked');return {uid:'google-uid',email:'google@example.com',email_verified:value!=='unverified',name:'Google Shopper',firebase:{sign_in_provider:value==='wrong-provider'?'password':'google.com'}};}};
 const f=await fixture(t,{firebaseAuth:verifier,firebaseConfig:{apiKey:'public-key',projectId:'test',authDomain:'test.firebaseapp.com',appId:'test'}});const c=f.client();
 assert.equal((await c.request('/api/auth/config')).data.googleEnabled,true);
 for(const idToken of ['bad','unverified','wrong-provider']) assert.equal((await c.request('/api/auth/google','POST',{idToken})).status,401);
 const first=await c.request('/api/auth/google','POST',{idToken:'good'});assert.equal(first.status,200);assert.equal(first.data.user.googleLinked,true);assert.equal(first.data.user.role,'customer');
 const stored=await f.app.locals.store.db.collection('users').findOne({_id:first.data.user.id});assert.equal(stored.passwordHash,undefined);
 const linked=await fixture(t,{firebaseAuth:verifier});const local=linked.client();await register(local,'google@example.com');
 assert.equal((await linked.client().request('/api/auth/google','POST',{idToken:'good'})).status,409);
 assert.equal((await local.request('/api/auth/google/link','POST',{idToken:'good'})).status,200);
 await local.request('/api/auth/logout','POST',{});
 assert.equal((await local.request('/api/auth/google','POST',{idToken:'good'})).status,200);
});
test('admin uploads, product CRUD, optimistic stock edits and archive protect checkout',async t=>{
 const cloud=testCloudinary();const f=await fixture(t,{cloudinary:cloud});const admin=await adminClient(f);const outsider=f.client();
 assert.equal((await upload(outsider)).status,401);assert.equal(cloud.calls,0);
 assert.equal((await upload(admin,Buffer.from('<svg>not an image</svg>'),'fake.png')).status,400);
 assert.equal((await upload(admin,Buffer.alloc(5*1024*1024+1))).status,413);
 const uploaded=await upload(admin);assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));assert.equal(cloud.calls,1);
 const input={name:'Desk plant <script>',description:'A little greenery.',category:'Home & Living',priceCents:2499,stock:10,imageId:uploaded.data.image.id};
 const result=await admin.request('/api/admin/products','POST',input);assert.equal(result.status,201,JSON.stringify(result.data));const product=result.data.product;assert.equal(product.id,9);assert.match(product.imageUrl,/res\.cloudinary\.com/);
 assert.equal((await outsider.request('/api/products/9')).data.product.name,input.name);
 assert.equal((await admin.request('/api/admin/products/9','PATCH',{...input,priceCents:2999,version:product.version})).status,200);
 assert.equal((await admin.request('/api/admin/products/9','PATCH',{...input,version:product.version})).status,409);
 const before=(await admin.request('/api/products/9')).data.product;
 await outsider.request('/api/cart/items','POST',{id:9,quantity:1});await f.checkout(outsider);
 assert.equal((await admin.request('/api/admin/products/9','PATCH',{...input,version:before.version})).status,409);
 const current=(await admin.request('/api/admin/products')).data.products.find(p=>p.id===9);
 assert.equal((await admin.request('/api/admin/products/9','DELETE',{version:current.version})).status,200);
 assert.equal((await outsider.request('/api/products/9')).status,404);
 assert.equal((await f.client().request('/api/cart/items','POST',{id:9,quantity:1})).status,404);
 assert.ok(await f.app.locals.store.db.collection('admin_audit').countDocuments()>=3);
 const users=(await admin.request('/api/admin/users')).data.users;assert.equal(users[0].passwordHash,undefined);
});
test('fulfilment changes cannot bypass Stripe payment and cannot undo shipment',async t=>{
 const f=await fixture(t);const admin=await adminClient(f);const c=f.client();await c.request('/api/cart/items','POST',{id:1,quantity:1});const {order}=await f.checkout(c);
 assert.equal((await admin.request('/api/admin/orders/'+order._id,'PATCH',{fulfillmentStatus:'shipped'})).status,409);
 f.stripe.pay(order.stripeSessionId);await f.webhook(order.stripeSessionId);
 assert.equal((await admin.request('/api/admin/orders/'+order._id,'PATCH',{fulfillmentStatus:'processing',status:'paid'})).status,200);
 assert.equal((await admin.request('/api/admin/orders/'+order._id,'PATCH',{fulfillmentStatus:'shipped',trackingNumber:'TRACK-123'})).status,200);
 assert.equal((await admin.request('/api/admin/orders/'+order._id,'PATCH',{fulfillmentStatus:'processing'})).status,409);
 const saved=(await c.request('/api/orders/'+order._id)).data.order;assert.equal(saved.status,'paid');assert.equal(saved.trackingNumber,'TRACK-123');
 assert.equal((await admin.request('/api/admin/overview')).data.revenueCents,order.totalCents);
});
test('Redis caches catalogue descriptions, invalidates edits and never serves stale price or stock',async t=>{
 const {openCache}=require('../backend/config/integrations');const redis=fakeRedis();const cache=await openCache({client:redis,namespace:randomUUID()});
 const f=await fixture(t,{cache});const c=f.client();let loads=0;const original=f.app.locals.store.listProducts;
 f.app.locals.store.listProducts=async(...args)=>{loads++;return original(...args);};
 await c.request('/api/products');await c.request('/api/products');assert.equal(loads,1);assert.equal(redis.sets,1);
 await f.app.locals.store.products.updateOne({_id:1},{$set:{stock:3,priceCents:1234}});
 let item=(await c.request('/api/products/1')).data.product;assert.equal(item.stock,3);assert.equal(item.price,12.34);
 await f.app.locals.store.products.updateOne({_id:1},{$set:{'details.name':'Updated name'}});await cache.invalidate();
 item=(await c.request('/api/products/1')).data.product;assert.equal(item.name,'Updated name');assert.equal(loads,2);
 const admin=await adminClient(f);
 const current=(await admin.request('/api/products/1')).data.product;
 assert.equal((await admin.request('/api/admin/products/1','PATCH',{name:'Admin updated name',description:current.description,category:current.category,priceCents:1999,stock:3,version:current.version})).status,200);
 assert.equal((await c.request('/api/products/1')).data.product.name,'Admin updated name');assert.equal(loads,3);
 redis.isReady=false;assert.equal((await c.request('/api/products')).status,200);
 assert.equal((await c.request('/api/health')).data.cache,'disabled');
});
test('auth rate limits, missing integrations and admin-only multipart uploads fail clearly',async t=>{
 const f=await fixture(t);const c=f.client();
 assert.equal((await c.request('/api/auth/google','POST',{idToken:'token'})).status,503);
 const admin=await adminClient(f);assert.equal((await upload(admin)).status,503);
 for(let i=0;i<20;i++) await c.request('/api/auth/login','POST',{email:'missing@example.com',password:'wrong'});
 assert.equal((await c.request('/api/auth/login','POST',{email:'missing@example.com',password:'wrong'})).status,429);
 const disabled=await fixture(t,{jwtSecret:''});assert.equal((await disabled.client().request('/api/auth/register','POST',{name:'Test',email:'new@example.com',password})).status,503);
});

test('login transfers a reserved guest checkout and stale account cookies cannot capture another account',async t=>{
 const f=await fixture(t);const c=f.client();await c.request('/api/cart/items','POST',{id:1,quantity:1});const {order}=await f.checkout(c);const guestCookie=c.cookie;
 const user=await register(c,'reserved@example.com');
 const cart=(await c.request('/api/cart')).data;assert.equal(cart.checkout.id,order._id);assert.equal(cart.items.length,1);
 const saved=await f.app.locals.store.orders.findOne({_id:order._id});assert.equal(saved.userId,user.id);assert.notEqual(saved.sessionId,order.sessionId);
 assert.equal((await f.client(guestCookie).request('/api/checkout/'+order._id)).status,404);
 f.stripe.pay(order.stripeSessionId);await f.webhook(order.stripeSessionId);
 assert.equal((await c.request('/api/cart')).data.items.length,0);
 const stale=c.cookie;await c.request('/api/auth/logout','POST',{});
 const second=f.client();const another=await register(second,'different@example.com');await second.request('/api/auth/logout','POST',{});
 const staleBrowser=f.client(stale);
 assert.equal((await staleBrowser.request('/api/auth/login','POST',{email:another.email,password})).status,200);
 assert.equal((await staleBrowser.request('/api/orders')).data.orders.length,0);
});
