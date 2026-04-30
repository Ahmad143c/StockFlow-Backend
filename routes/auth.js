const express = require('express');
const router = express.Router();
const { login } = require('../controllers/authController');


const { register } = require('../controllers/authController');


const User = require('../models/User');

router.post('/login', login);
router.post('/register', register);


// Update seller info
router.put('/update/:id', async (req, res) => {
	try {
		const { shopName, username, sellingPoint, productCategory, password } = req.body;
		const user = await User.findById(req.params.id);
		if (!user) return res.status(404).json({ message: 'Seller not found' });

		// Update fields
		if (shopName) user.shopName = shopName;
		if (username) user.username = username;
		if (sellingPoint) user.sellingPoint = sellingPoint;
		if (productCategory) user.productCategory = productCategory;

		// If password is provided, set it and increment passwordVersion
		// The pre-save middleware will handle hashing
		if (password) {
			user.password = password;
			user.passwordVersion = (user.passwordVersion || 0) + 1;
		}

		await user.save();
		res.json({ message: 'Seller updated successfully', user });
	} catch (err) {
		res.status(500).json({ message: 'Failed to update seller' });
	}
});

// Delete seller
router.delete('/delete/:id', async (req, res) => {
	try {
		const user = await User.findByIdAndDelete(req.params.id);
		if (!user) return res.status(404).json({ message: 'Seller not found' });
		res.json({ message: 'Seller deleted successfully' });
	} catch (err) {
		res.status(500).json({ message: 'Failed to delete seller' });
	}
});

module.exports = router;
