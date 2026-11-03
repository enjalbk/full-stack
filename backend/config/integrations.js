'use strict';
const {createClient}=require('redis');
const {createHash,randomUUID}=require('node:crypto');
const cloudinary=require('cloudinary').v2;
const {initializeApp,cert,getApps}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
function firebaseSettings(env=process.env) {
 const firebaseConfig=env.FIREBASE_API_KEY && env.FIREBASE_AUTH_DOMAIN && env.FIREBASE_PROJECT_ID && env.FIREBASE_APP_ID ?
  {apiKey:env.FIREBASE_API_KEY,authDomain:env.FIREBASE_AUTH_DOMAIN,projectId:env.FIREBASE_PROJECT_ID,appId:env.FIREBASE_APP_ID}:null;
 if(!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return {firebaseAuth:null,firebaseConfig};
 const name='temazon-'+env.FIREBASE_PROJECT_ID;
 const app=getApps().find(app=>app.name===name) || initializeApp({credential:cert({projectId:env.FIREBASE_PROJECT_ID,clientEmail:env.FIREBASE_CLIENT_EMAIL,privateKey:env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n')})},name);
 return {firebaseAuth:getAuth(app),firebaseConfig};
}
async function openCache({url=process.env.REDIS_URL,namespace='temazon',client:provided}={}) {
 let client=provided;
 if(!client && url) {
  client=createClient({url,disableOfflineQueue:true,commandsQueueMaxLength:100,socket:{connectTimeout:1500,reconnectStrategy:retries=>retries<2?250:false}});
  client.on('error',()=>{});
  try{await client.connect();}catch{if(client.isOpen) client.destroy();client=null;console.warn('Redis is unavailable; catalogue requests will use MongoDB.');}
 }
 const prefix='temazon:'+createHash('sha256').update(namespace).digest('hex').slice(0,20);
 async function remember(key,loader) {
  if(!client?.isReady) return loader();
  let cacheKey;
  try {const version=await client.get(prefix+':version') || '0';cacheKey=prefix+':'+version+':'+key;const value=await client.get(cacheKey);if(value) return JSON.parse(value);}catch{return loader();}
  const result=await loader();
  try{await client.set(cacheKey,JSON.stringify(result),{EX:30});}catch{}
  return result;
 }
 return {remember,async invalidate(){if(client?.isReady) try{await client.incr(prefix+':version');}catch{}},
  get enabled(){return Boolean(client?.isReady);},async close(){if(client && !provided && client.isOpen) client.destroy();}};
}
function cloudinaryService(env=process.env) {
 if(!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) return null;
 const settings={cloud_name:env.CLOUDINARY_CLOUD_NAME,api_key:env.CLOUDINARY_API_KEY,api_secret:env.CLOUDINARY_API_SECRET};
 return {upload(buffer){return new Promise((resolve,reject)=>{
  const stream=cloudinary.uploader.upload_stream({...settings,resource_type:'image',folder:'temazon',public_id:randomUUID(),overwrite:false,allowed_formats:['jpg','jpeg','png','webp'],transformation:[{width:1600,height:1600,crop:'limit'}]},(error,result)=>error?reject(error):resolve(result));
  stream.end(buffer);
 });},async destroy(publicId){return cloudinary.uploader.destroy(publicId,{...settings,resource_type:'image'});}};
}
module.exports={firebaseSettings,openCache,cloudinaryService};
