const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const purchaseOrderController = require('../controllers/purchaseOrderController');

// Validation middleware
const validatePO = [
  check('vendorId', 'Vendor is required').notEmpty(),
  check('items', 'At least one item is required').isArray({ min: 1 }),
  check('items.*.itemCode', 'Item code is required').notEmpty(),
  check('items.*.quantityOrdered', 'Quantity must be a positive number').isFloat({ min: 0.01 }),
  check('items.*.unitPrice', 'Unit price must be a positive number').isFloat({ min: 0 })
];

// Create a new purchase order
router.post('/', validatePO, purchaseOrderController.create);

// Get all purchase orders with optional filtering
router.get('/', purchaseOrderController.getAll);

// Get a single purchase order
router.get('/:id', purchaseOrderController.getOne);

// Update a purchase order
router.put('/:id', validatePO, purchaseOrderController.update);

// Delete a purchase order
router.delete('/:id', purchaseOrderController.delete);

module.exports = router;
