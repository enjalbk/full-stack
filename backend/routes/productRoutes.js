'use strict';
const {Router}=require('express');
function productRoutes(controller) {
  const router=Router();
  router.get('/',controller.list);
  router.get('/:id',controller.detail);
  return router;
}
module.exports={productRoutes};
