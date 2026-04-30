const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// Get all products
router.get('/', productController.getAll);
// Get product by ID
router.get('/:id', productController.getProductById);
// Create product
router.post('/', productController.create);
// Update product
router.put('/:id', productController.update);
// Delete product
router.delete('/:id', productController.delete);

module.exports = router;
