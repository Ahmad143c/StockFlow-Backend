const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { auth } = require('../middleware/auth');

// Create vendor
router.post('/', auth, vendorController.createVendor);
// Get all vendors
router.get('/', auth, vendorController.getAllVendors);
// Get vendor by ID
router.get('/:id', auth, vendorController.getVendorById);
// Update vendor
router.put('/:id', auth, vendorController.updateVendor);
// Delete vendor
router.delete('/:id', auth, vendorController.deleteVendor);

module.exports = router;
