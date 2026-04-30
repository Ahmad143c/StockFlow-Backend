const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Get all sellers (users with role 'staff')
router.get('/sellers', async (req, res) => {
  try {
    const sellers = await User.find({ role: 'staff' });
    res.json(sellers);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch sellers' });
  }
});

module.exports = router;
