const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function auth(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user exists and passwordVersion matches
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // If passwordVersion in token doesn't match current user's passwordVersion, password was changed
    const tokenPasswordVersion = decoded.passwordVersion || 0;
    const userPasswordVersion = user.passwordVersion || 0;
    if (tokenPasswordVersion !== userPasswordVersion) {
      return res.status(401).json({ message: 'Password changed. Please login again.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
}

function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
}

module.exports = { auth, admin };
