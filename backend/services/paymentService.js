'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {fail}=require('../utils/httpError');
const hash=value=>createHash('sha256').update(value).digest('hex');
const {publicOrder}=require('../utils/serializers');
function createPayments(store,{stripe,origin}) {
  async function ownedOrder(id,sessionId,userId) {
    const order=await store.orders.findOne(userId?{_id:id,$or:[{sessionId},{userId}]}:{_id:id,sessionId});
    if(!order) fail(404,'Order not found.'); return order;
  }
  // Reserving inventory and locking the guest cart are committed together.
  async function reserve(sessionId,key,customer) {
    const requestHash=hash(JSON.stringify(customer));
    return store.transaction(async session=>{
      const previous=await store.orders.findOne({sessionId,requestKey:key},{session});
      if(previous) {
        if(previous.requestHash!==requestHash) fail(409,'This checkout key was already used with different details.');
        return previous;
      }
      const guest=await store.getSession(sessionId,session);
      if(!guest) fail(401,'Your shopping session expired. Reload the page.');
      if(guest.activeCheckoutId) {
        const active=await store.orders.findOne({_id:guest.activeCheckoutId},{session});
        if(active?.requestHash===requestHash) return active;
        fail(409,'Finish or cancel your current checkout first.');
      }
      const cart=await store.cartFor(sessionId,session);
      if(!cart.items.length) fail(400,'Your bag is empty.');
      for(const item of cart.items) {
        const changed=await store.products.updateOne({_id:item.id,active:{$ne:false},stock:{$gte:item.quantity}},{$inc:{stock:-item.quantity,version:1}},{session});
        if(!changed.modifiedCount) fail(409,`${item.product.name} has insufficient stock. Please update your bag.`);
      }
      const order={_id:randomUUID(),sessionId,requestKey:key,requestHash,customer,
        ...(guest.userId?{userId:guest.userId}:{}),createdAt:new Date().toISOString(),status:'awaiting-payment',checkoutOrigin:origin,
        stripeExpiresAt:Math.floor(Date.now()/1000)+2100,
        items:cart.items.map(item=>({id:item.id,name:item.product.name,quantity:item.quantity,unitPriceCents:item.unitPriceCents})),
        currency:'USD',subtotalCents:cart.subtotalCents,shippingCents:cart.shippingCents,totalCents:cart.totalCents};
      await store.orders.insertOne(order,{session});
      await store.sessions.updateOne({_id:sessionId},{$set:{activeCheckoutId:order._id},$inc:{revision:1}},{session});
      return order;
    });
  }
  async function checkout(order) {
    if(order.status!=='awaiting-payment') fail(409,'This checkout has already finished. Check your order status.');
    let remote;
    if(order.stripeSessionId) remote=await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    else {
      // The immutable payload and stable Stripe key recover safely after a timeout or server restart.
      remote=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],
        client_reference_id:order._id,metadata:{orderId:order._id},customer_email:order.customer.email,
        line_items:order.items.map(item=>({price_data:{currency:'usd',unit_amount:item.unitPriceCents,product_data:{name:item.name}},quantity:item.quantity})),
        shipping_options:[{shipping_rate_data:{type:'fixed_amount',fixed_amount:{amount:order.shippingCents,currency:'usd'},display_name:order.shippingCents?'Standard shipping':'Free shipping'}}],
        expires_at:order.stripeExpiresAt,
        success_url:`${order.checkoutOrigin}/checkout.html?order=${order._id}`,
        cancel_url:`${order.checkoutOrigin}/cart.html?checkout=cancelled&order=${order._id}`
      },{idempotencyKey:`temazon-checkout-${order._id}`});
      await store.orders.updateOne({_id:order._id,status:'awaiting-payment'},{$set:{stripeSessionId:remote.id}});
    }
    if(remote.status!=='open') {await reconcile(remote); fail(409,'This checkout is no longer open. Reload your bag to see its status.');}
    return {orderId:order._id,url:remote.url};
  }
  async function reconcile(remote) {
    const id=remote.metadata?.orderId;
    if(!id) return;
    await store.transaction(async session=>{
      const order=await store.orders.findOne({_id:id},{session});
      if(!order || order.status!=='awaiting-payment') return;
      if(remote.client_reference_id!==id || (order.stripeSessionId && order.stripeSessionId!==remote.id)) fail(409,'Checkout reference mismatch.');
      let status;
      if(remote.payment_status==='paid') {
        if(remote.amount_total!==order.totalCents || remote.currency!=='usd') fail(409,'Checkout amount mismatch.');
        status='paid';
      } else if(remote.status==='expired') status='expired';
      else return;
      if(status==='expired') for(const item of order.items) await store.products.updateOne({_id:item.id},{$inc:{stock:item.quantity,version:1}},{session});
      await store.orders.updateOne({_id:id},{$set:{status,stripeSessionId:remote.id,paymentIntentId:typeof remote.payment_intent==='string'?remote.payment_intent:null,updatedAt:new Date().toISOString()}},{session});
      const update={$unset:{activeCheckoutId:''},$inc:{revision:1}};
      if(status==='paid') update.$set={items:[]};
      await store.sessions.updateOne({_id:order.sessionId,activeCheckoutId:id},update,{session});
    });
  }
  return {async start(sessionId,key,customer){return checkout(await reserve(sessionId,key,customer));},
    async resume(id,sessionId,userId){return checkout(await ownedOrder(id,sessionId,userId));},
    async status(id,sessionId,userId){
      let order=await ownedOrder(id,sessionId,userId);
      if(order.status==='awaiting-payment' && order.stripeSessionId) {await reconcile(await stripe.checkout.sessions.retrieve(order.stripeSessionId));order=await ownedOrder(id,sessionId,userId);}
      return publicOrder(order);
    },
    async cancel(id,sessionId,userId){
      const order=await ownedOrder(id,sessionId,userId);
      if(order.status!=='awaiting-payment') return publicOrder(order);
      // Recover an ambiguously-created Stripe session before cancelling it.
      if(!order.stripeSessionId) {await checkout(order);return this.cancel(id,sessionId,userId);}
      let remote=await stripe.checkout.sessions.retrieve(order.stripeSessionId);
      if(remote.status==='open') {
        try {remote=await stripe.checkout.sessions.expire(remote.id);}
        catch(error) {remote=await stripe.checkout.sessions.retrieve(remote.id);if(remote.status==='open') throw error;}
      }
      await reconcile(remote);
      return publicOrder(await ownedOrder(id,sessionId,userId));
    },
    async handleEvent(event){
      if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired'].includes(event.type)) {
        // Retrieve authoritative payment state; event delivery order cannot undo a paid order.
        await reconcile(await stripe.checkout.sessions.retrieve(event.data.object.id));
      }
    }};
}
module.exports={createPayments};
