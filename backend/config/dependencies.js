'use strict';
const Stripe=require('stripe');
const {openDatabase}=require('./database');
const {firebaseSettings,openCache,cloudinaryService}=require('./integrations');
const {createPayments}=require('../services/paymentService');
async function createDependencies(options={}) {
  const origin=options.origin || process.env.APP_URL || 'http://localhost:8080';
  const url=new URL(origin);
  if(!['http:','https:'].includes(url.protocol) || url.origin!==origin) throw new Error('APP_URL must be an origin such as http://localhost:8080, without a trailing slash.');
  const jwtSecret=options.jwtSecret ?? process.env.JWT_SECRET;
  if(jwtSecret && Buffer.byteLength(jwtSecret)<32) throw new Error('JWT_SECRET must contain at least 32 bytes.');
  const firebase=options.firebaseAuth!==undefined?{firebaseAuth:options.firebaseAuth,firebaseConfig:options.firebaseConfig || null}:firebaseSettings();
  const store=await openDatabase({uri:options.mongoUri || process.env.MONGODB_URI,databaseName:options.databaseName || process.env.MONGODB_DB || 'temazon'});
  let cache;
  try {
    const stripe=options.stripe || (process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY,{maxNetworkRetries:2,timeout:15000}):null);
    const webhookSecret=options.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    const payments=stripe?createPayments(store,{stripe,origin}):null;
    cache=options.cache || await openCache({namespace:(process.env.REDIS_PREFIX || 'temazon')+':'+store.db.databaseName});
    const cloudinary=options.cloudinary!==undefined?options.cloudinary:cloudinaryService();
    return {store,cache,stripe,webhookSecret,payments,cloudinary,authOptions:{secret:jwtSecret,...firebase}};
  } catch(error) {
    if(cache) await cache.close();
    await store.close();
    throw error;
  }
}
module.exports={createDependencies};
