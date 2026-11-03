'use strict';
let products = [];
const categories = ['All','Electronics','Fashion','Accessories','Home & Living','Beauty'];
const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const photo = product => product.imageUrl || 'https://images.unsplash.com/'+encodeURIComponent(product.image)+'?auto=format&fit=crop&w=700&q=80';
let cart = [];
let serverTotals = {subtotal:0,shipping:0,total:0};
let ready = false;
let pending = Promise.resolve();
let checkoutPending = false;
let checkoutKey = null;
let activeCheckout = null;
async function api(url, options = {}) {
 const response = await fetch(url, {credentials:'same-origin', ...options, headers:{'Content-Type':'application/json','X-Temazon-Request':'1', ...options.headers}});
 const data = await response.json();
 if (!response.ok) {const error=new Error(data.error || 'The request failed. Please try again.'); error.status=response.status; throw error;}
 return data;
}
function applyCart(data) {
 activeCheckout = data.checkout || null;
 cart = data.items.map(item => ({id:item.id,quantity:item.quantity}));
 for(const item of data.items) {const index=products.findIndex(p=>p.id===item.id); if(index>=0) products[index]=item.product;}
 serverTotals = {subtotal:data.subtotalCents/100,shipping:data.shippingCents/100,total:data.totalCents/100};
 updateCartCount();
}
function queueCart(operation) {
 if (!ready || checkoutPending) {toast('Please wait for your bag to load.'); return;}
 if(activeCheckout) {toast('Finish or cancel your Stripe checkout before changing your bag.'); return;}
 pending = pending.then(operation).catch(error => toast(error.message));
 return pending;
}
let selectedCategory = 'All';
let toastTimer;
function toast(message) {
 const element = document.getElementById('toast');
 if (!element) return;
 element.textContent = message; element.classList.add('visible');
 clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 3200);
}
function updateCartCount() {const count = document.getElementById('cart-count'); if(count) count.textContent = cart.reduce((sum,item) => sum + item.quantity,0);}
function addToCart(id, quantity = 1) {
 return queueCart(async () => {
  const data = await api('/api/cart/items', {method:'POST',body:JSON.stringify({id,quantity})});
  applyCart(data); renderCart(); toast('Added to your bag.');
 });
}
function selectCategory(category) {
 selectedCategory = category;
 document.querySelectorAll('.filter-btn').forEach(button => {const active = button.dataset.category === category; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));});
 displayProducts();
}
function displayProducts() {
 const list = document.getElementById('product-list'); if (!list) return;
 const term = document.getElementById('search-input').value.trim().toLowerCase();
 const filtered = products.filter(p => (selectedCategory === 'All' || p.category === selectedCategory) && `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(term));
 const sort = document.getElementById('sort-products').value;
 if(sort === 'price-low') filtered.sort((a,b) => a.price-b.price);
 if(sort === 'price-high') filtered.sort((a,b) => b.price-a.price);
 if(sort === 'rating') filtered.sort((a,b) => b.rating-a.rating);
 document.getElementById('results-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'find' : 'finds'} for your everyday`;
 list.innerHTML = filtered.length ? filtered.map(p => `<article class="product-card"><a href="product.html?id=${p.id}" class="product-image-link"><img class="product-image" src="${escapeHTML(photo(p))}" alt="${escapeHTML(p.name)}" loading="lazy"></a><p class="product-category">${escapeHTML(p.category)}</p><h3><a href="product.html?id=${p.id}">${escapeHTML(p.name)}</a></h3><p class="rating"><span aria-hidden="true">★</span> ${p.rating} <span class="muted">/ 5 · Demo rating</span></p><div class="product-bottom"><span class="product-price">${money(p.price)}</span><button class="add-cart-btn" data-add="${p.id}" ${p.stock ? '' : 'disabled'} aria-label="Add ${escapeHTML(p.name)} to bag">Add to bag +</button></div></article>`).join('') : '<div class="empty-state"><h3>No finds just yet</h3><p>Try another search or explore all categories.</p><button id="reset-filters" class="shop-btn">Clear filters</button></div>';
 document.getElementById('reset-filters')?.addEventListener('click',() => {document.getElementById('search-input').value=''; selectCategory('All');});
}
function displayProductDetails() {
 const container = document.getElementById('product-details'); if(!container) return;
 const product = products.find(p => p.id === Number(new URLSearchParams(location.search).get('id')));
 if(!product) {container.innerHTML='<div class="empty-state"><h1>Product not found</h1><p>This item is not in our collection.</p><a class="shop-btn" href="/#products">Explore the collection</a></div>'; return;}
 document.title = `${product.name} | Temazon`;
 container.innerHTML=`<div class="product-details"><img class="details-image" src="${escapeHTML(photo(product))}" alt="${escapeHTML(product.name)}"><div class="details-info"><p class="eyebrow">THE TEMAZON COLLECTION</p><p class="details-category">${escapeHTML(product.category)}</p><h1>${escapeHTML(product.name)}</h1><p class="rating">★ ${product.rating} / 5 · Demo rating</p><p class="details-price">${money(product.price)}</p><p class="details-description">${escapeHTML(product.description)}</p><p class="stock-note">${product.stock ? 'In stock' : 'Out of stock'} &middot; Demo product</p><form id="product-form"><label class="quantity-label" for="quantity">Quantity</label><input type="number" id="quantity" class="quantity-input" value="1" min="1" max="99" required><button class="details-add-btn" ${product.stock ? '' : 'disabled'}>Add to bag &rarr;</button></form><p class="delivery-note">Free shipping on orders $50+. Otherwise $5.99.<br>Payment is completed on Stripe. Temazon does not store your card details.</p></div></div>`;
 document.getElementById('product-form').addEventListener('submit',event => {event.preventDefault(); addToCart(product.id,Number(document.getElementById('quantity').value));});
}
function totals() {return serverTotals;}
function renderCart() {
 const container = document.getElementById('cart-content'); if(!container) return;
 const checkout = document.getElementById('checkout-section'); checkout.hidden = true;
 if(activeCheckout) {
  container.innerHTML='<div class="empty-state"><h2>Your Stripe checkout is in progress.</h2><p>Your items are reserved while checkout is open. Resume payment or cancel to edit your bag.</p><p id="reserved-total"></p><button class="shop-btn" id="resume-payment">Resume Stripe checkout</button> <button class="shop-btn" id="cancel-payment">Cancel checkout</button></div>';
  document.getElementById('reserved-total').textContent='Reserved total: '+money(serverTotals.total);
  document.getElementById('resume-payment').addEventListener('click',async event=>{
   event.currentTarget.disabled=true;
   try {const data=await api('/api/checkout/'+encodeURIComponent(activeCheckout.id)+'/resume',{method:'POST',body:'{}'});window.location.assign(data.url);}
   catch(error) {toast(error.message);event.target.disabled=false;}
  });
  document.getElementById('cancel-payment').addEventListener('click',async event=>{
   event.currentTarget.disabled=true;
   try {await api('/api/checkout/'+encodeURIComponent(activeCheckout.id)+'/cancel',{method:'POST',body:'{}'});applyCart(await api('/api/cart'));renderCart();toast('Checkout closed. Your bag is ready.');}
   catch(error) {toast(error.message);event.target.disabled=false;}
  });
  return;
 }
 if(!cart.length) {container.innerHTML='<div class="empty-state"><span class="empty-icon">♡</span><h2>Your next favorite is out there.</h2><p>Your bag is empty. Let’s find something you love.</p><a class="shop-btn" href="/#products">Explore the collection &rarr;</a></div>'; return;}
 const {subtotal,shipping,total} = totals();
 container.innerHTML=`<div class="cart-layout"><div class="cart-items">${cart.map(item=> {const p=products.find(p=>p.id===item.id); return `<article class="cart-item"><a href="product.html?id=${p.id}"><img src="${escapeHTML(photo(p))}" alt="${escapeHTML(p.name)}"></a><div><p class="product-category">${escapeHTML(p.category)}</p><h2><a href="product.html?id=${p.id}">${escapeHTML(p.name)}</a></h2><p>${money(p.price)}</p><div class="quantity-controls"><button data-adjust="${p.id}" data-delta="-1" aria-label="Decrease ${escapeHTML(p.name)} quantity" ${item.quantity===1?'disabled':''}>−</button><span aria-label="Quantity">${item.quantity}</span><button data-adjust="${p.id}" data-delta="1" aria-label="Increase ${escapeHTML(p.name)} quantity" ${item.quantity===99?'disabled':''}>+</button><button class="remove-btn" data-remove="${p.id}">Remove</button></div></div><strong>${money(p.price*item.quantity)}</strong></article>`;}).join('')}</div><aside class="order-summary"><h2>Order summary</h2><p><span>Subtotal</span><span>${money(subtotal)}</span></p><p><span>Shipping</span><span>${shipping ? money(shipping) : 'Free'}</span></p><p class="summary-total"><strong>Total (USD)</strong><strong>${money(total)}</strong></p><p class="summary-note">${subtotal<50 ? `${money(50-subtotal)} away from free shipping.`:'Your order qualifies for free shipping.'}</p><button class="details-add-btn" id="checkout-btn">Continue to checkout &rarr;</button><p class="summary-note">Payment via Stripe Checkout. Tax is not calculated.</p></aside></div>`;
 document.getElementById('checkout-btn').addEventListener('click',()=>{checkout.hidden=false; checkout.scrollIntoView({behavior:'smooth',block:'start'}); checkout.querySelector('input').focus({preventScroll:true});});
}
document.addEventListener('click',event=>{
 const add=event.target.closest('[data-add]'); if(add) addToCart(Number(add.dataset.add));
 const adjust=event.target.closest('[data-adjust]'); if(adjust) queueCart(async()=> {
  const id=Number(adjust.dataset.adjust); const item=cart.find(p=>p.id===id); if(!item) return;
  const data=await api('/api/cart/items/'+id,{method:'PATCH',body:JSON.stringify({quantity:item.quantity+Number(adjust.dataset.delta)})});
  applyCart(data); renderCart();
  document.querySelector('[data-adjust="'+id+'"][data-delta="'+adjust.dataset.delta+'"]')?.focus();
 });
 const remove=event.target.closest('[data-remove]'); if(remove) queueCart(async()=> {
  applyCart(await api('/api/cart/items/'+Number(remove.dataset.remove),{method:'DELETE',body:'{}'}));
  renderCart(); toast('Item removed from your bag.'); document.querySelector('[data-remove], #cart-content .shop-btn')?.focus();
 });
});
const filters=document.querySelector('.filter-buttons');
if(filters) {
 filters.innerHTML=categories.map(category=>`<button class="filter-btn ${category==='All'?'active':''}" data-category="${category}" aria-pressed="${category==='All'}">${category}</button>`).join('');
 document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{selectCategory(button.dataset.category); if(button.classList.contains('category-card')) document.getElementById('products').scrollIntoView({behavior:'smooth'});}));
 document.getElementById('search-input').addEventListener('input',displayProducts);
 document.querySelector('.search-container').addEventListener('submit',event=>{event.preventDefault();displayProducts();document.getElementById('products').scrollIntoView({behavior:'smooth'});});
 document.getElementById('sort-products').addEventListener('change',displayProducts);
}
document.getElementById('checkout-form')?.addEventListener('submit',async event=>{
 event.preventDefault(); if(!ready || checkoutPending) return;
 const form=event.currentTarget; const button=form.querySelector('button');
 checkoutPending=true; button.disabled=true; button.textContent='Opening Stripe Checkout...';
 try {
  await pending;
  const customer=Object.fromEntries(new FormData(form));
  if(!checkoutKey) checkoutKey=crypto.randomUUID();
  const data=await api('/api/checkout/sessions',{method:'POST',headers:{'Idempotency-Key':checkoutKey},body:JSON.stringify({customer})});
  window.location.assign(data.url);
 } catch(error) {
  if(error.status>=400 && error.status<500) checkoutKey=null;
  toast(error.message);
  try {applyCart(await api('/api/cart'));renderCart();} catch {}
 } finally {checkoutPending=false;button.disabled=false;button.textContent='Pay with Stripe';}
});
async function initialize() {
 const list=document.getElementById('product-list');
 if(list) list.innerHTML='<p role="status">Loading the collection...</p>';
 const bag=document.getElementById('cart-content');
 if(bag) bag.innerHTML='<p role="status">Loading your bag...</p>';
 try {
  const catalogue=await api('/api/products'); products=catalogue.products;
  const params=new URLSearchParams(location.search);
  if(params.get('checkout')==='cancelled' && params.get('order')) {
   try {await api('/api/checkout/'+encodeURIComponent(params.get('order'))+'/cancel',{method:'POST',body:'{}'});}
   catch(error) {toast(error.message);}
   window.history.replaceState({},'',location.pathname);
  }
  applyCart(await api('/api/cart'));
  ready=true; displayProducts(); displayProductDetails(); renderCart();
 } catch(error) {
  const container=bag || list || document.getElementById('product-details');
  if(container) {container.innerHTML='<div class="empty-state"><h2>We could not load the store.</h2><p>Check that the backend is running, then reload this page.</p><button class="shop-btn" id="retry-load">Try again</button></div>'; document.getElementById('retry-load').addEventListener('click',initialize);}
  toast(error.message);
 }
}
window.addEventListener('pageshow',event=>{if(event.persisted) initialize();});
window.addEventListener('focus',async()=>{
 if(!ready || checkoutPending) return;
 try {await pending; const data=await api('/api/cart'); applyCart(data); if(document.getElementById('checkout-section')?.hidden) renderCart();} catch(error) {toast(error.message);}
});
initialize();
