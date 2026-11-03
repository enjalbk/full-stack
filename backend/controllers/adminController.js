'use strict';
const {randomUUID}=require('node:crypto');
const {fail}=require('../utils/httpError');
const {publicOrder,publicUser}=require('../utils/serializers');
const CATEGORIES=['Electronics','Fashion','Accessories','Home & Living','Beauty'];
function productInput(body) {
 const result={};
 for(const [field,max] of Object.entries({name:120,description:3000,category:50})) {
  const value=body?.[field];if(typeof value!=='string' || !value.trim() || value.trim().length>max) fail(400,`Provide a valid ${field}.`);result[field]=value.trim();
 }
 if(!CATEGORIES.includes(result.category)) fail(400,'Choose a supported category.');
 if(!Number.isSafeInteger(body?.priceCents) || body.priceCents<1 || body.priceCents>100000000) fail(400,'Price must be an integer between 1 and 100000000 cents.');
 if(!Number.isSafeInteger(body?.stock) || body.stock<0 || body.stock>1000000) fail(400,'Stock must be an integer between 0 and 1000000.');
 return {...result,priceCents:body.priceCents,stock:body.stock};
}
function imageType(buffer) {
 if(buffer.length>=8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
 if(buffer.length>=3 && buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return 'jpeg';
 if(buffer.length>=12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP') return 'webp';
 return null;
}
function createAdminController(store,{cache,cloudinary}) {

 const media=store.db.collection('media');const audit=store.db.collection('admin_audit');
 const record=(actor,action,target,session)=>audit.insertOne({_id:randomUUID(),actorId:actor._id,action,target,createdAt:new Date().toISOString()},{session});






 async function detailsFor(input,body,existing,session) {
  let image=existing?.details.image;let imageUrl=existing?.details.imageUrl;let imageId=existing?.details.imageId;
  if(body.imageId) {
   if(typeof body.imageId!=='string') fail(400,'Upload a valid product image.');
   const asset=await media.findOne({_id:body.imageId},{session});if(!asset) fail(400,'Upload a product image before saving.');
   imageUrl=asset.url;imageId=asset._id;image=undefined;
  }
  if(!image && !imageUrl) fail(400,'Upload a product image before saving.');
  const details={name:input.name,description:input.description,category:input.category,rating:existing?.details.rating || 0};
  if(image) details.image=image;if(imageUrl) details.imageUrl=imageUrl;if(imageId) details.imageId=imageId;
  return details;
 }



 async function overview(req,res) {
  const [products,customers,orders,revenue]=await Promise.all([store.products.countDocuments({active:{$ne:false}}),store.db.collection('users').countDocuments(),store.orders.countDocuments(),store.orders.aggregate([{$match:{status:'paid'}},{$group:{_id:null,total:{$sum:'$totalCents'}}}]).toArray()]);
  res.json({products,customers,orders,revenueCents:revenue[0]?.total || 0});
 }
 async function listProducts(req,res) {return res.json({products:await store.listProducts(true)});}
 async function listUsers(req,res) {return res.json({users:(await store.db.collection('users').find().sort({createdAt:-1}).limit(50).toArray()).map(publicUser)});}
 async function listOrders(req,res) {return res.json({orders:(await store.orders.find().sort({createdAt:-1,_id:-1}).limit(100).toArray()).map(publicOrder)});}
 async function updateOrder(req,res) {
  const status=req.body?.fulfillmentStatus;const tracking=req.body?.trackingNumber;
  if(!['processing','shipped'].includes(status)) fail(400,'Choose processing or shipped.');
  if(tracking!==undefined && (typeof tracking!=='string' || tracking.length>150)) fail(400,'Tracking number must be at most 150 characters.');
  await store.transaction(async session=>{
   const order=await store.orders.findOne({_id:req.params.id},{session});if(!order) fail(404,'Order not found.');
   if(order.status!=='paid') fail(409,'Only paid orders can be fulfilled.');
   if(order.fulfillmentStatus==='shipped' && status!=='shipped') fail(409,'A shipped order cannot move backwards.');
   await store.orders.updateOne({_id:order._id},{$set:{fulfillmentStatus:status,trackingNumber:(tracking || '').trim(),updatedAt:new Date().toISOString()}},{session});
   await record(req.user,'order.fulfillment',order._id,session);
  });res.json({ok:true});
 }
 async function uploadImage(req,res) {
  if(!req.file || !imageType(req.file.buffer)) fail(400,'Upload a PNG, JPEG, or WebP image (up to 5 MB).');
  const result=await cloudinary.upload(req.file.buffer);
  let url;try{url=new URL(result.secure_url);}catch{fail(502,'Image upload did not return a valid URL.');}
  if(url.protocol!=='https:' || url.hostname!=='res.cloudinary.com' || typeof result.public_id!=='string') fail(502,'Image upload did not return a valid Cloudinary URL.');
  const image={_id:randomUUID(),url:result.secure_url,publicId:result.public_id,uploadedBy:req.user._id,createdAt:new Date().toISOString()};
  try{await media.insertOne(image);}catch(error){try{await cloudinary.destroy(result.public_id);}catch{}throw error;}
  res.status(201).json({image:{id:image._id,url:image.url}});
 }
 async function createProduct(req,res) {
  const input=productInput(req.body);let id;
  await store.transaction(async session=>{
   const counter=await store.db.collection('counters').findOneAndUpdate({_id:'products'},{$inc:{value:1}},{session,returnDocument:'after'});id=counter.value;
   const details=await detailsFor(input,req.body,null,session);
   await store.products.insertOne({_id:id,details,priceCents:input.priceCents,stock:input.stock,active:true,version:0},{session});
   await record(req.user,'product.create',String(id),session);
  });await cache.invalidate();res.status(201).json({product:await store.getProduct(id)});
 }
 async function updateProduct(req,res) {
  const id=Number(req.params.id);const input=productInput(req.body);
  if(!Number.isSafeInteger(id) || !Number.isSafeInteger(req.body?.version)) fail(400,'A valid product ID and version are required.');
  await store.transaction(async session=>{
   const existing=await store.products.findOne({_id:id},{session});if(!existing) fail(404,'Product not found.');
   if((existing.version || 0)!==req.body.version) fail(409,'Product changed. Reload it before saving.');
   const details=await detailsFor(input,req.body,existing,session);
   await store.products.updateOne({_id:id},{$set:{details,priceCents:input.priceCents,stock:input.stock},$inc:{version:1}},{session});
   await record(req.user,'product.update',String(id),session);
  });await cache.invalidate();res.json({product:await store.getProduct(id,true)});
 }
 async function archiveProduct(req,res) {
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id) || !Number.isSafeInteger(req.body?.version)) fail(400,'A valid product ID and version are required.');
  await store.transaction(async session=>{
   const existing=await store.products.findOne({_id:id},{session});if(!existing) fail(404,'Product not found.');
   if((existing.version || 0)!==req.body.version) fail(409,'Product changed. Reload it before archiving.');
   await store.products.updateOne({_id:id},{$set:{active:false},$inc:{version:1}},{session});await record(req.user,'product.archive',String(id),session);
  });await cache.invalidate();res.json({ok:true});
 }
 return {overview,listProducts,listUsers,listOrders,updateOrder,uploadImage,createProduct,updateProduct,archiveProduct};
}
module.exports={createAdminController};
