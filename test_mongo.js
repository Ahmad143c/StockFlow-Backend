const mongoose = require('mongoose');
const Sale = require('./models/Sale');
require('dotenv').config();

async function test() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const sales = await Sale.find().limit(1);
    if (!sales.length) {
      console.log('Database returned 0 sales.');
    } else {
      console.log('Found sale:', sales[0]._id);
      try {
        sales[0].paidAmount += 1;
        sales[0].paymentStatus = 'Partial Paid';
        await sales[0].save();
        console.log('Save successful');
      } catch (err) {
        console.error('Save failed with error:', err.message);
        console.error('Full trace:', err);
      }
    }
  } catch (err) {
    console.error('Connection error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

test();
