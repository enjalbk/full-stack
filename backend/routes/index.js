'use strict';
const {Router}=require('express');
const {authRoutes}=require('./authRoutes');
const {adminRoutes}=require('./adminRoutes');
const {productRoutes}=require('./productRoutes');
const {cartRoutes}=require('./cartRoutes');
const {orderRoutes}=require('./orderRoutes');
const {checkoutRoutes}=require('./checkoutRoutes');
const {guestSession}=require('../middleware/guestSession');
function apiRoutes(controllers,dependencies) {
  const router=Router();
  router.use('/auth',authRoutes(controllers.auth));
  router.use('/admin',adminRoutes(controllers.admin,dependencies));
  router.get('/health',controllers.health);
  router.use('/products',productRoutes(controllers.products));
  router.get('/categories',controllers.products.categories);
  router.use(['/cart','/orders','/checkout'],guestSession(dependencies.store));
  router.use('/cart',cartRoutes(controllers.cart));
  router.use('/orders',orderRoutes(controllers.orders));
  router.use('/checkout',checkoutRoutes(controllers.checkout));
  return router;
}
module.exports={apiRoutes};
