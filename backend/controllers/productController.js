'use strict';
const {fail}=require('../utils/httpError');
const {productId}=require('../utils/validation');
function createProductController({catalogue}) {
  async function list(req,res) {
    const q=typeof req.query.q==='string'?req.query.q.trim().toLowerCase():'';
    const category=typeof req.query.category==='string'?req.query.category:'All';
    const sort=req.query.sort || 'featured';
    if(!['featured','price-low','price-high','rating'].includes(sort)) fail(400,'Invalid sort order.');
    const products=(await catalogue()).filter(product=>(category==='All' || product.category===category) && `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(q));
    if(sort==='price-low') products.sort((a,b)=>a.price-b.price);
    if(sort==='price-high') products.sort((a,b)=>b.price-a.price);
    if(sort==='rating') products.sort((a,b)=>b.rating-a.rating);
    res.json({products});
  }
  async function detail(req,res) {
    const id=productId(req.params.id);
    const product=(await catalogue()).find(product=>product.id===id);
    if(!product) fail(404,'Product not found.');
    res.json({product});
  }
  async function categories(req,res) {
    res.json({categories:[...new Set((await catalogue()).map(product=>product.category))]});
  }
  return {list,detail,categories};
}
module.exports={createProductController};
