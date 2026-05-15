const express = require('express');
const router = express.Router();
const glController = require('../controllers/glController');
const { auth, admin } = require('../middleware/auth');

router.get('/trial-balance', auth, glController.getTrialBalance);
router.get('/profit-loss', auth, glController.getProfitAndLoss);
router.get('/balance-sheet', auth, glController.getBalanceSheet);
router.get('/ledger/:accountId', auth, glController.getLedgerByAccount);

module.exports = router;
