'use strict';
window.Temazon={
 async request(url,options={}) {
  const upload=options.body instanceof FormData;
  const response=await fetch(url,{credentials:'same-origin',...options,headers:{...(upload?{}:{'Content-Type':'application/json'}),'X-Temazon-Request':'1',...options.headers}});
  const data=await response.json();if(!response.ok){const error=new Error(data.error || 'Please try again.');error.status=response.status;throw error;}return data;
 },
 escape(value){return String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));},
 money(cents){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);},
 image(product){return product.imageUrl || 'https://images.unsplash.com/'+encodeURIComponent(product.image)+'?auto=format&fit=crop&w=500&q=80';}
};
