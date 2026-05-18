const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { auth, admin } = require('../middleware/auth');

router.post('/', auth, customerController.createCustomer);
router.get('/', auth, customerController.getAllCustomers);
router.get('/outstanding', auth, customerController.getOutstandingBalances);
router.delete('/delete-client', auth, customerController.deleteCustomerByDetails);
router.get('/:id', auth, customerController.getCustomerById);
router.post('/payment', auth, customerController.addPayment);
router.get('/ledger/:customerId', auth, customerController.getCustomerLedger);

module.exports = router;
