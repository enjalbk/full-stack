'use strict';
const {Router,raw}=require('express');
function stripeRoutes(controller) {
  const router=Router();
  router.post('/webhook',raw({type:'application/json',limit:'256kb'}),controller.webhook);
  return router;
}
module.exports={stripeRoutes};
