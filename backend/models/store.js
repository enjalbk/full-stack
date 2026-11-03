'use strict';
const {fail}=require('../utils/httpError');
const presentProduct = row => ({id:row._id,...row.details,price:row.priceCents/100,stock:row.stock,active:row.active!==false,version:row.version || 0});
function createStore(client,db) {
  const products=db.collection('products');
  const sessions=db.collection('sessions');
  const orders=db.collection('orders');
    const transaction = callback => client.withSession(session=>session.withTransaction(()=>callback(session),{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary'}));
    async function getSession(id,transactionSession) {
      return sessions.findOne({_id:id,expiresAt:{$gt:new Date()}},{session:transactionSession});
    }
    async function cartFor(id,transactionSession) {
      const guest=await getSession(id,transactionSession);
      if(!guest) fail(401,'Your shopping session expired. Reload the page.');
      const items=[];
      for (const item of guest.items) {
        const product=await products.findOne({_id:item.id},{session:transactionSession});
        if (!product) fail(409,'A product in your bag is no longer available.');
        items.push({...item,product:presentProduct(product),unitPriceCents:product.priceCents});
      }
      const subtotalCents=items.reduce((sum,item)=>sum+item.unitPriceCents*item.quantity,0);
      const shippingCents=subtotalCents===0 || subtotalCents>=5000 ? 0 : 599;
      let checkout=null;
      if(guest.activeCheckoutId) {
        const order=await orders.findOne({_id:guest.activeCheckoutId,status:'awaiting-payment'},{session:transactionSession});
        if(order) checkout={id:order._id,status:order.status};
      }
      return {items,currency:'USD',subtotalCents,shippingCents,totalCents:subtotalCents+shippingCents,checkout};
    }
    async function changeCart(id,productId,amount,mode) {
      await transaction(async session=>{
        const guest=await getSession(id,session);
        if(!guest) fail(401,'Your shopping session expired. Reload the page.');
        if(guest.activeCheckoutId) fail(409,'Finish or cancel your current Stripe checkout before changing your bag.');
        const existing=guest.items.find(item=>item.id===productId);
        if(mode==='remove') guest.items=guest.items.filter(item=>item.id!==productId);
        else {
          if(mode==='set' && !existing) fail(404,'Item is not in your bag.');
          const product=await products.findOne({_id:productId},{session});
          if(!product || product.active===false) fail(404,'Product not found.');
          const next=mode==='add' ? (existing?.quantity || 0)+amount : amount;
          if(next>99 || next>product.stock) fail(409,'Requested quantity is not available.');
          if(existing) existing.quantity=next; else guest.items.push({id:productId,quantity:next});
        }
        await sessions.updateOne({_id:id},{$set:{items:guest.items},$inc:{revision:1}},{session});
      });
      return cartFor(id);
    }
    return {client,db,products,sessions,orders,transaction,getSession,cartFor,changeCart,
      async health(){await db.command({ping:1});},
      async listProducts(includeArchived=false){return (await products.find(includeArchived?{}:{active:{$ne:false}}).sort({_id:1}).toArray()).map(presentProduct);},
      async getProduct(id,includeArchived=false){const row=await products.findOne(includeArchived?{_id:id}:{_id:id,active:{$ne:false}});return row ? presentProduct(row) : null;},
      async close(){await client.close();}};
}
module.exports={createStore};
