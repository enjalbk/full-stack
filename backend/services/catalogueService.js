'use strict';
function createCatalogueService(store,cache) {
  async function catalogue() {
    // Redis holds descriptions only; transactional prices and stock come from MongoDB.
    const metadata=await cache.remember('catalogue',async()=>(await store.listProducts()).map(({stock,price,version,active,...product})=>product));
    const live=await store.products.find({active:{$ne:false}},{projection:{priceCents:1,stock:1,version:1}}).sort({_id:1}).toArray();
    const byId=new Map(metadata.map(product=>[product.id,product]));
    const result=[];
    for(const row of live) {
      const item=byId.get(row._id) || await store.getProduct(row._id);
      if(item) result.push({...item,price:row.priceCents/100,stock:row.stock,version:row.version || 0,active:true});
    }
    return result;
  }
  return {catalogue};
}
module.exports={createCatalogueService};
