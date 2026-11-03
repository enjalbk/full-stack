'use strict';
const orderId=new URLSearchParams(location.search).get('order');
const title=document.getElementById('payment-title');
const message=document.getElementById('payment-status');
const reference=document.getElementById('payment-reference');
const button=document.getElementById('check-payment');
let checks=0;
let timer;
async function checkPayment() {
 clearTimeout(timer);
 if(!orderId) {title.textContent='Order reference missing';message.textContent='Open your bag to continue shopping.';button.hidden=true;return;}
 button.disabled=true;
 try {
  const response=await fetch('/api/checkout/'+encodeURIComponent(orderId),{credentials:'same-origin'});
  const data=await response.json();if(!response.ok) throw new Error(data.error || 'Unable to check payment.');
  reference.textContent='Order reference: '+data.order.id;
  if(data.order.status==='paid') {
   title.textContent='Payment confirmed. Thank you!';
   message.textContent='Order total: '+new Intl.NumberFormat('en-US',{style:'currency',currency:data.order.currency}).format(data.order.totalCents/100)+'. Your payment has been verified with Stripe.';
   button.hidden=true;
  } else if(data.order.status==='expired') {
   title.textContent='Checkout expired';message.textContent='Your reserved stock has been released. Your items remain in your bag.';button.hidden=true;
  } else {
   title.textContent='Payment is awaiting confirmation';message.textContent='We have not confirmed payment yet. You can resume checkout from your bag.';
   if(++checks<15) timer=setTimeout(checkPayment,2000);
  }
 } catch(error) {title.textContent='We could not check your payment';message.textContent=error.message;}
 finally {button.disabled=false;}
}
button.addEventListener('click',checkPayment);
checkPayment();
