'use strict';
const {request,escape:escapeHtml,money,image}=window.Temazon;
const message=document.getElementById('admin-message');
const form=document.getElementById('product-editor');
let products=[];let editing=null;let imageId=null;let uploading=false;
function notify(text,error=false){message.textContent=text;message.classList.toggle('error-message',error);}
function resetEditor() {
 editing=null;imageId=null;form.reset();document.getElementById('editor-title').textContent='Add a good find.';document.getElementById('editor-eyebrow').textContent='NEW PRODUCT';document.getElementById('product-image-preview').hidden=true;document.getElementById('upload-status').textContent='';
}
function renderProducts() {
 document.getElementById('admin-products').innerHTML=products.map(p=>'<tr><td><div class="admin-product-name"><img src="'+escapeHtml(image(p))+'" alt=""><div><strong>'+escapeHtml(p.name)+'</strong><small>'+escapeHtml(p.category)+(p.active?'':' &middot; Archived')+'</small></div></div></td><td>'+money(Math.round(p.price*100))+'</td><td>'+p.stock+'</td><td><button class="text-button" data-edit="'+p.id+'">Edit</button> '+(p.active?'<button class="text-button danger-text" data-archive="'+p.id+'">Archive</button>':'Archived')+'</td></tr>').join('');
}
function renderOrders(orders) {
 const container=document.getElementById('admin-orders');
 container.innerHTML=orders.length?orders.map(order=>'<article class="admin-order"><div class="order-card-heading"><strong>'+escapeHtml(order.customer.name)+'</strong><span class="status-pill">'+escapeHtml(order.status)+'</span></div><p class="muted-copy">'+escapeHtml(order.id)+' &middot; '+escapeHtml(new Date(order.createdAt).toLocaleString())+'</p><p>'+escapeHtml(order.customer.email)+'</p><p>'+escapeHtml(order.customer.address)+', '+escapeHtml(order.customer.city)+' '+escapeHtml(order.customer.postal)+'</p><p>'+order.items.map(item=>escapeHtml(item.name)+' &times; '+item.quantity).join(', ')+'</p><strong>'+money(order.totalCents)+'</strong>'+(order.status==='paid'?'<form data-fulfill="'+escapeHtml(order.id)+'" class="fulfill-form"><label>Fulfilment<select name="fulfillmentStatus"><option value="processing" '+(order.fulfillmentStatus==='processing'?'selected':'')+'>Processing</option><option value="shipped" '+(order.fulfillmentStatus==='shipped'?'selected':'')+'>Shipped</option></select></label><label>Tracking number<input name="trackingNumber" maxlength="150" value="'+escapeHtml(order.trackingNumber || '')+'"></label><button class="outline-button" type="submit">Update fulfilment</button></form>':'<p class="muted-copy">Fulfilment becomes available after payment.</p>')+'</article>').join(''):'<div class="empty-state"><h3>No orders yet.</h3><p>Orders will appear here when shoppers check out.</p></div>';
}
async function refresh() {
 const [stats,collection,orders,users]=await Promise.all([request('/api/admin/overview'),request('/api/admin/products'),request('/api/admin/orders'),request('/api/admin/users')]);products=collection.products;
 document.getElementById('admin-stats').innerHTML=[['Paid revenue',money(stats.revenueCents)],['Active products',stats.products],['Orders',stats.orders],['Customers',stats.customers]].map(([label,value])=>'<div class="stat-card"><p>'+label+'</p><strong>'+value+'</strong></div>').join('');
 renderProducts();renderOrders(orders.orders);
 document.getElementById('admin-users').innerHTML=users.users.map(user=>'<tr><td>'+escapeHtml(user.name)+'</td><td>'+escapeHtml(user.email)+'</td><td>'+escapeHtml(user.role)+'</td><td>'+escapeHtml(new Date(user.createdAt).toLocaleDateString())+'</td></tr>').join('');
}
function edit(id) {
 const product=products.find(p=>p.id===id);if(!product)return;
 editing=product;imageId=null;form.reset();
 form.elements.name.value=product.name;form.elements.category.value=product.category;form.elements.price.value=product.price.toFixed(2);form.elements.stock.value=product.stock;form.elements.description.value=product.description;
 document.getElementById('editor-title').textContent='Edit '+product.name;document.getElementById('editor-eyebrow').textContent='PRODUCT #'+id;
 const preview=document.getElementById('product-image-preview');preview.src=image(product);preview.hidden=false;document.getElementById('upload-status').textContent='Current image will be kept unless you upload a replacement.';
 document.querySelector('.product-editor').scrollIntoView({behavior:'smooth',block:'start'});form.elements.name.focus({preventScroll:true});
}
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
 document.querySelectorAll('[data-tab]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));document.getElementById(tab.dataset.tab+'-panel').hidden=!active;});
}));
document.getElementById('new-product').addEventListener('click',()=>{resetEditor();document.querySelector('.product-editor').scrollIntoView({behavior:'smooth'});form.elements.name.focus({preventScroll:true});});
document.getElementById('cancel-edit').addEventListener('click',resetEditor);
document.getElementById('refresh-admin').addEventListener('click',async()=>{try{await refresh();notify('Store data refreshed.');}catch(error){notify(error.message,true);}});
document.getElementById('admin-products').addEventListener('click',async event=>{
 const editButton=event.target.closest('[data-edit]');if(editButton)edit(Number(editButton.dataset.edit));
 const archive=event.target.closest('[data-archive]');if(!archive)return;
 const product=products.find(p=>p.id===Number(archive.dataset.archive));archive.disabled=true;
 try{await request('/api/admin/products/'+product.id,{method:'DELETE',body:JSON.stringify({version:product.version})});await refresh();if(editing?.id===product.id)resetEditor();notify('Product archived. Existing orders are kept.');}catch(error){notify(error.message,true);archive.disabled=false;}
});
document.getElementById('upload-image').addEventListener('click',async()=>{
 const file=document.getElementById('product-image-file').files[0];if(!file){notify('Choose an image first.',true);return;}if(file.size>5*1024*1024){notify('Choose an image smaller than 5 MB.',true);return;}
 uploading=true;document.getElementById('upload-image').disabled=true;document.getElementById('save-product').disabled=true;document.getElementById('upload-status').textContent='Uploading image...';
 try {const data=new FormData();data.append('image',file);const result=await request('/api/admin/images',{method:'POST',body:data});imageId=result.image.id;const preview=document.getElementById('product-image-preview');preview.src=result.image.url;preview.hidden=false;document.getElementById('upload-status').textContent='Image uploaded. Save the product to use it.';}
 catch(error){document.getElementById('upload-status').textContent=error.message;notify(error.message,true);}
 finally{uploading=false;document.getElementById('upload-image').disabled=false;document.getElementById('save-product').disabled=false;}
});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(uploading)return;
 const values=Object.fromEntries(new FormData(form));const payload={name:values.name,category:values.category,description:values.description,priceCents:Math.round(Number(values.price)*100),stock:Number(values.stock)};
 if(imageId)payload.imageId=imageId;if(editing)payload.version=editing.version;
 document.getElementById('save-product').disabled=true;
 try{await request('/api/admin/products'+(editing?'/'+editing.id:''),{method:editing?'PATCH':'POST',body:JSON.stringify(payload)});resetEditor();await refresh();notify('Product saved.');}
 catch(error){notify(error.message,true);}finally{document.getElementById('save-product').disabled=false;}
});
document.getElementById('admin-orders').addEventListener('submit',async event=>{
 const target=event.target.closest('[data-fulfill]');if(!target)return;event.preventDefault();const button=target.querySelector('button');button.disabled=true;
 try{await request('/api/admin/orders/'+encodeURIComponent(target.dataset.fulfill),{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(target)))});await refresh();notify('Order fulfilment updated.');}catch(error){notify(error.message,true);button.disabled=false;}
});
async function initialize() {
 try{const {user}=await request('/api/auth/me');if(user?.role!=='admin'){document.getElementById('admin-denied').hidden=false;notify('');return;}document.getElementById('admin-app').hidden=false;await refresh();notify('Welcome to your store dashboard.');}
 catch(error){notify(error.message,true);if(error.status===401 || error.status===403)document.getElementById('admin-denied').hidden=false;}
}
initialize();
