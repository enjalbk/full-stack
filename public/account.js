'use strict';
const {request,escape:escapeHtml,money}=window.Temazon;
const message=document.getElementById('account-message');
let googleClient=null;
let currentUser=null;
function notify(text,error=false){message.textContent=text;message.classList.toggle('error-message',error);}
function tab(mode) {
 for(const name of ['login','register']) {const active=name===mode;document.getElementById(name+'-form').hidden=!active;document.getElementById('show-'+name).classList.toggle('active',active);document.getElementById('show-'+name).setAttribute('aria-pressed',String(active));}
 document.getElementById('auth-title').textContent=mode==='login'?'Welcome back.':'Make yourself at home.';notify('');
}
async function orders() {
 const container=document.getElementById('account-orders');
 try {
  const data=await request('/api/orders');
  container.innerHTML=data.orders.length?data.orders.map(order=>'<article class="order-card"><div class="order-card-heading"><strong>'+escapeHtml(new Date(order.createdAt).toLocaleDateString())+'</strong><span class="status-pill">'+escapeHtml(order.status)+'</span></div><p class="muted-copy">Reference: '+escapeHtml(order.id)+'</p><p>'+order.items.map(item=>escapeHtml(item.name)+' &times; '+item.quantity).join(', ')+'</p><div class="order-card-heading"><strong>'+money(order.totalCents)+'</strong>'+(order.status==='awaiting-payment'?'<button class="outline-button" data-resume="'+escapeHtml(order.id)+'">Resume payment</button>':'<span>'+escapeHtml(order.fulfillmentStatus || 'Not dispatched')+'</span>')+'</div>'+(order.trackingNumber?'<p>Tracking: '+escapeHtml(order.trackingNumber)+'</p>':'')+'</article>').join(''):'<div class="empty-state"><h3>Your next favorite is waiting.</h3><p>Your orders will appear here.</p><a class="shop-btn" href="/#products">Explore the collection</a></div>';
 } catch(error) {container.textContent=error.message;}
}
async function load() {
 try {
  const {user}=await request('/api/auth/me');currentUser=user;
  document.getElementById('auth-panel').hidden=Boolean(user);document.getElementById('profile-panel').hidden=!user;
  if(user) {document.getElementById('profile-name').textContent='Hello, '+user.name;document.getElementById('profile-email').textContent=user.email;document.getElementById('admin-link').hidden=user.role!=='admin';document.getElementById('password-panel').hidden=!user.hasPassword;document.getElementById('link-google').hidden=user.googleLinked || !googleClient;await orders();}
 } catch(error) {notify(error.message,true);}
}
async function handleForm(form,path) {
 const button=form.querySelector('button');button.disabled=true;notify('');
 try{await request(path,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();await load();}
 catch(error){notify(error.message,true);}finally{button.disabled=false;}
}
for(const mode of ['login','register']) {
 document.getElementById('show-'+mode).addEventListener('click',()=>tab(mode));
 document.getElementById(mode+'-form').addEventListener('submit',event=>{event.preventDefault();handleForm(event.currentTarget,'/api/auth/'+mode);});
}
document.getElementById('logout').addEventListener('click',async()=>{try{await request('/api/auth/logout',{method:'POST',body:'{}'});notify('You have signed out.');await load();}catch(error){notify(error.message,true);}});
document.getElementById('password-form').addEventListener('submit',async event=>{event.preventDefault();await handleForm(event.currentTarget,'/api/auth/password');});
async function google(link=false) {
 if(!googleClient) return;
 const button=document.getElementById(link?'link-google':'google-login');button.disabled=true;notify('');
 try {
  const result=await googleClient.sdk.signInWithPopup(googleClient.auth,new googleClient.sdk.GoogleAuthProvider());
  const idToken=await result.user.getIdToken();
  await request(link?'/api/auth/google/link':'/api/auth/google',{method:'POST',body:JSON.stringify({idToken})});await load();
 } catch(error) {notify(error.code==='auth/popup-closed-by-user'?'Google sign-in was closed. Please try again.':error.message,true);}
 finally {try{await googleClient.sdk.signOut(googleClient.auth);}catch{}button.disabled=false;}
}
document.getElementById('google-login').addEventListener('click',()=>google());
document.getElementById('link-google').addEventListener('click',()=>google(true));
document.getElementById('account-orders').addEventListener('click',async event=>{
 const button=event.target.closest('[data-resume]');if(!button) return;button.disabled=true;
 try{const data=await request('/api/checkout/'+encodeURIComponent(button.dataset.resume)+'/resume',{method:'POST',body:'{}'});window.location.assign(data.url);}catch(error){notify(error.message,true);button.disabled=false;}
});
async function setup() {
 await load();
 try {
  const config=await request('/api/auth/config');
  if(!config.passwordEnabled){notify('Accounts are not configured yet. Set JWT_SECRET on the server.',true);document.querySelectorAll('#login-form input, #login-form button, #register-form input, #register-form button').forEach(element=>element.disabled=true);}
  if(!config.googleEnabled) {document.getElementById('google-note').textContent='Google sign-in is available after Firebase is configured.';return;}
  const [app,sdk]=await Promise.all([import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js')]);
  const auth=sdk.getAuth(app.initializeApp(config.firebase));await sdk.setPersistence(auth,sdk.inMemoryPersistence);googleClient={auth,sdk};document.getElementById('google-login').disabled=false;
  if(currentUser) document.getElementById('link-google').hidden=currentUser.googleLinked;
 } catch{document.getElementById('google-note').textContent='Google sign-in could not load. Email sign-in is still available when configured.';}
}
tab(new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'register' : 'login');
setup();
