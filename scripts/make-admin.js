'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {openDatabase}=require('../backend/config/database');
async function main() {
 if(fs.existsSync(path.join(__dirname,'..','.env'))) process.loadEnvFile(path.join(__dirname,'..','.env'));
 const email=process.argv[2]?.trim().toLowerCase();const remove=process.argv[3]==='--remove';
 if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: npm run admin -- user@example.com [--remove]');
 const store=await openDatabase();
 try {
  const result=await store.db.collection('users').updateOne({email},{$set:{role:remove?'customer':'admin'}});
  if(!result.matchedCount) throw new Error('Account not found. Create it through the account page first.');
  await store.db.collection('admin_audit').insertOne({actorId:'local-admin-command',action:remove?'admin.revoke':'admin.grant',target:email,createdAt:new Date().toISOString()});
  console.log(remove?'Administrator access removed.':'Administrator access granted. Refresh your account page.');
 } finally {await store.close();}
}
main().catch(error=>{console.error(error.message.startsWith('Usage:') || error.message.startsWith('Account not found') || error.message.startsWith('MONGODB_URI')?error.message:'Admin update failed. Check MongoDB connectivity and configuration.');process.exitCode=1;});
