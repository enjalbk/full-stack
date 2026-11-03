'use strict';
const {fail}=require('../utils/httpError');
const {validateCustomer}=require('../middleware/security');
function createCheckoutController({payments,stripe,webhookSecret}) {
  function configured(req,res,next) {
    if(!payments || !webhookSecret) return res.status(503).json({error:'Stripe is not configured. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to .env.'});
    next();
  }
  async function start(req,res) {
    const key=req.get('Idempotency-Key');
    if(!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail(400,'A valid Idempotency-Key header is required.');
    res.status(201).json(await payments.start(req.sessionId,key,validateCustomer(req.body)));
  }
  async function resume(req,res) {res.json(await payments.resume(req.params.id,req.sessionId,req.user?._id));}
  async function cancel(req,res) {res.json({order:await payments.cancel(req.params.id,req.sessionId,req.user?._id)});}
  async function status(req,res) {res.json({order:await payments.status(req.params.id,req.sessionId,req.user?._id)});}
  async function webhook(req,res) {
    if(!payments || !webhookSecret) return res.status(503).json({error:'Stripe webhooks are not configured.'});
    let event;
    try {event=stripe.webhooks.constructEvent(req.body,req.get('Stripe-Signature'),webhookSecret);}
    catch {return res.status(400).json({error:'Invalid Stripe webhook signature.'});}
    await payments.handleEvent(event);
    res.json({received:true});
  }
  return {configured,start,resume,cancel,status,webhook};
}
module.exports={createCheckoutController};
