const mongoose = require('mongoose');
const Product = require('../models/Product');

// Seed a product with a known ID for testing
async function seedProduct() {
  await mongoose.connect('mongodb://localhost:27017/inventory');
  const productId = new mongoose.Types.ObjectId('68a0c0ee800de347d93202ff');
  const exists = await Product.findById(productId);
  if (!exists) {
    await Product.create({
      _id: productId,
      name: 'Test Product',
      category: 'Test Category',
      subCategory: 'Test Sub',
      brand: 'Test Brand',
  vendor: 'Test Vendor',
      costPerPiece: 10,
      sellingPerPiece: 15,
      costPerCarton: 100,
      sellingPerCarton: 150,
      cartonQuantity: 5,
      piecesPerCarton: 20,
      losePieces: 2,
      color: 'Red',
      stockQuantity: 100,
      totalPieces: 120,
      perPieceProfit: 5,
      totalUnitProfit: 100,
      totalUnitCost: 500,
      SKU: 'TESTSKU123',
      image: '',
      warrantyMonths: 12,
    });
    console.log('Seeded test product.');
  } else {
    console.log('Test product already exists.');
  }
  mongoose.disconnect();
}

seedProduct();
