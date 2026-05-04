const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const { auth, admin } = require('../middleware/auth');

// Seller creates a new sale
router.post('/', auth, saleController.createSale);
// List sales (Admin sees all, Seller sees their own)
router.get('/', auth, saleController.getSales);

// Resend email for a sale
router.post('/:id/resend-email', auth, saleController.resendEmail);

// Refund items for a sale
router.post('/:id/refund', auth, saleController.refundSale);

// Warranty claim for items in a sale
router.post('/:id/warranty-claim', auth, saleController.claimWarranty);

// Get recent refunds (for notifications)
router.get('/refunds/recent', auth, saleController.getRecentRefunds);

// Get all refunds for a specific seller
router.get('/refunds', auth, saleController.getRefundsBySeller);

// Get recent warranty claims (for notifications)
router.get('/warranty/recent', auth, saleController.getRecentWarrantyClaims);

// Get sale by ID (must be after specific routes)
router.get('/:id', auth, saleController.getSaleById);
// Update sale (limited fields)
router.put('/:id', auth, saleController.updateSale);

// Delete all sales for a seller (admin only)
router.delete('/seller/:sellerId', admin, saleController.deleteSalesBySeller);

// Delete all refunds for a seller (admin only)
router.delete('/refunds/seller/:sellerId', admin, saleController.deleteRefundsBySeller);

module.exports = router;
