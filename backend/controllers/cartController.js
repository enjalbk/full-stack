'use strict';
const {productId,quantity}=require('../utils/validation');
function createCartController(store) {
  async function show(req,res) {res.json(await store.cartFor(req.sessionId));}
  async function add(req,res) {res.status(201).json(await store.changeCart(req.sessionId,productId(req.body?.id),quantity(req.body?.quantity),'add'));}
  async function update(req,res) {res.json(await store.changeCart(req.sessionId,productId(req.params.id),quantity(req.body?.quantity),'set'));}
  async function remove(req,res) {res.json(await store.changeCart(req.sessionId,productId(req.params.id),null,'remove'));}
  return {show,add,update,remove};
}
module.exports={createCartController};
