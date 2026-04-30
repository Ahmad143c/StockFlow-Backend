const express = require('express');
const router = express.Router();
const { getAll, getProductById, create, update, delete: del, getProductAnalytics } = require('../controllers/productController');
// const { auth, admin } = require('../middleware/auth');


router.get('/', getAll);
router.get('/:id', getProductById);
router.get('/:id/analytics', getProductAnalytics);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', del);

module.exports = router;
