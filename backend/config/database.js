'use strict';
const {MongoClient} = require('mongodb');
const seed = require('../data/products');
const {createStore}=require('../models/store');
async function openDatabase({uri=process.env.MONGODB_URI,databaseName=process.env.MONGODB_DB || 'temazon'}={}) {
  if (!uri) throw new Error('MONGODB_URI is required. Set it in .env before starting Temazon.');
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:10000});
  try {
    await client.connect();
    const db=client.db(databaseName);
    const topology=await db.admin().command({hello:1});
    if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('MongoDB must be an Atlas cluster or a replica set: checkout requires transactions.');
    const products=db.collection('products');
    const sessions=db.collection('sessions');
    const orders=db.collection('orders');
    await db.collection('users').createIndex({email:1},{unique:true});
    await db.collection('users').createIndex({firebaseUid:1},{unique:true,partialFilterExpression:{firebaseUid:{$type:'string'}}});
    await db.collection('auth_sessions').createIndex({expiresAt:1},{expireAfterSeconds:0});
    await orders.createIndex({userId:1,createdAt:-1});
    await sessions.createIndex({expiresAt:1},{expireAfterSeconds:0});
    await orders.createIndex({sessionId:1,requestKey:1},{unique:true});
    await orders.createIndex({sessionId:1,createdAt:-1});
    await orders.createIndex({stripeSessionId:1},{unique:true,partialFilterExpression:{stripeSessionId:{$type:'string'}}});
    await products.bulkWrite(seed.map(p=>({updateOne:{filter:{_id:p.id},update:{$setOnInsert:{details:p,priceCents:Math.round(p.price*100),stock:100,active:true,version:0}},upsert:true}})));
    const highest=await products.find().sort({_id:-1}).limit(1).next();
    await db.collection('counters').updateOne({_id:'products'},{$max:{value:highest?._id || 0}},{upsert:true});
    return createStore(client,db);
  } catch(error) {await client.close();throw error;}
}
module.exports={openDatabase};
