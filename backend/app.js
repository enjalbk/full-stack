'use strict';
const express=require('express');
const path=require('node:path');
const {createDependencies}=require('./config/dependencies');
const {createCatalogueService}=require('./services/catalogueService');
const {createOrderModel}=require('./models/orderModel');
const {createAuthController}=require('./controllers/authController');
const {createAdminController}=require('./controllers/adminController');
const {createProductController}=require('./controllers/productController');
const {createCartController}=require('./controllers/cartController');
const {createOrderController}=require('./controllers/orderController');
const {createCheckoutController}=require('./controllers/checkoutController');
const {createHealthController}=require('./controllers/healthController');
const {apiRoutes}=require('./routes');
const {stripeRoutes}=require('./routes/stripeRoutes');
const {securityHeaders,protectApi,apiRateLimit,apiNotFound,errorHandler}=require('./middleware/http');
async function createApp(options={}) {
  const dependencies=await createDependencies(options);
  const {store,cache,authOptions}=dependencies;
  try {
    const controllers={
      auth:createAuthController(store,authOptions),
      admin:createAdminController(store,dependencies),
      products:createProductController(createCatalogueService(store,cache)),
      cart:createCartController(store),
      orders:createOrderController(createOrderModel(store)),
      checkout:createCheckoutController(dependencies),
      health:createHealthController(dependencies)
    };
    const app=express();
    app.locals.store=store;
    app.locals.cache=cache;
    app.locals.close=async()=>{await cache.close();await store.close();};
    app.disable('x-powered-by');
    app.use(securityHeaders);
    // Keep the raw Stripe webhook ahead of JSON parsing and storefront CSRF checks.
    app.use('/api/stripe',stripeRoutes(controllers.checkout));
    app.use('/api',protectApi,apiRateLimit(),express.json({limit:'16kb'}),controllers.auth.identify,apiRoutes(controllers,dependencies),apiNotFound);
    app.use(express.static(path.join(__dirname,'..','public')));
    app.use(errorHandler);
    return app;
  } catch(error) {
    await cache.close();
    await store.close();
    throw error;
  }
}
module.exports={createApp};
