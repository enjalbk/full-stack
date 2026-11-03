'use strict';
const {fail}=require('../utils/httpError');
const {publicOrder}=require('../utils/serializers');
function createOrderController(orders) {
  const identity=req=>({sessionId:req.sessionId,userId:req.user?._id});
  async function list(req,res) {res.json({orders:(await orders.listForOwner(identity(req))).map(publicOrder)});}
  async function detail(req,res) {
    const order=await orders.findForOwner(req.params.id,identity(req));
    if(!order) fail(404,'Order not found.');
    res.json({order:publicOrder(order)});
  }
  function rejectDirectCreation(req,res) {res.status(410).json({error:'Use Stripe Checkout at /api/checkout/sessions.'});}
  return {list,detail,rejectDirectCreation};
}
module.exports={createOrderController};
