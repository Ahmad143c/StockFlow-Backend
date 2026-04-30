const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');

// Get a single purchase order
exports.getOne = async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Purchase order not found' });
    
    // Populate brand information for each item
    if (order.items && order.items.length > 0) {
      const enhancedItems = await Promise.all(
        order.items.map(async (item) => {
          try {
            // Try to find product by itemCode (SKU) to get brand information
            const product = await Product.findOne({ SKU: item.itemCode });
            return {
              ...item.toObject(),
              brand: product ? product.brand : null,
              category: product ? product.category : null,
              vendor: product ? product.vendor : null
            };
          } catch (err) {
            console.warn(`Could not find product for itemCode: ${item.itemCode}`);
            return item.toObject();
          }
        })
      );
      
      // Replace items with enhanced items containing brand info
      const orderObj = order.toObject();
      orderObj.items = enhancedItems;
      return res.json(orderObj);
    }
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching purchase order', error });
  }
};

// Update a purchase order
exports.update = async (req, res) => {
  try {
    // Recalculate totals if items or shipping charges are being updated
    if (req.body.items || req.body.shippingCharges !== undefined) {
      const order = await PurchaseOrder.findById(req.params.id);
      if (!order) return res.status(404).json({ message: 'Purchase order not found' });
      
      const items = req.body.items || order.items;
      let subtotal = 0, taxTotal = 0, discountTotal = 0;
      
      items.forEach(item => {
        const price = Number(item.unitPrice) || 0;
        const tax = Number(item.tax) || 0;
        const discount = Number(item.discount) || 0;
        
        subtotal += price;
        taxTotal += tax;
        discountTotal += discount;
      });
      
      const shippingCharges = Number(req.body.shippingCharges) || order.shippingCharges || 0;
      const grandTotal = subtotal + taxTotal - discountTotal + shippingCharges;
      
      req.body.subtotal = subtotal;
      req.body.taxTotal = taxTotal;
      req.body.discountTotal = discountTotal;
      req.body.shippingCharges = shippingCharges;
      req.body.grandTotal = grandTotal;
    }
    
    // We need the previous order to detect status transitions
    const prevOrder = await PurchaseOrder.findById(req.params.id);
    if (!prevOrder) return res.status(404).json({ message: 'Purchase order not found' });

    // Align payment status/date logic with create flow before persisting
    try {
      const paymentTerms = req.body.paymentTerms;
      const grandTotal = Number(req.body.grandTotal ?? 0);
      if (paymentTerms === 'Advance Payment' && req.body.advanceAmount !== undefined) {
        const advancePaid = Number(req.body.advanceAmount) || 0;
        req.body.paymentStatus = advancePaid >= grandTotal ? 'Paid' : (advancePaid > 0 ? 'Partially Paid' : 'Unpaid');
        if (advancePaid > 0 && !req.body.advancePaymentDateTime) {
          req.body.advancePaymentDateTime = new Date();
        }
      } else if (paymentTerms === 'Partial Payment' && (req.body.initialPayment !== undefined || req.body.finalPayment !== undefined)) {
        const initialPayment = Number(req.body.initialPayment) || 0;
        const finalPayment = Number(req.body.finalPayment) || 0;
        const totalPaid = initialPayment + finalPayment;
        if (totalPaid >= grandTotal && grandTotal > 0) {
          req.body.paymentStatus = 'Paid';
          if (!req.body.finalPaymentDateTime && finalPayment > 0) {
            req.body.finalPaymentDateTime = new Date();
          }
          if (!req.body.initialPaymentDateTime && initialPayment > 0) {
            req.body.initialPaymentDateTime = new Date();
          }
        } else if (totalPaid > 0) {
          req.body.paymentStatus = 'Partially Paid';
          if (!req.body.initialPaymentDateTime && initialPayment > 0) {
            req.body.initialPaymentDateTime = new Date();
          }
        } else {
          req.body.paymentStatus = 'Unpaid';
        }
      } else if (paymentTerms === 'Cash Payment') {
        const cashPaid = Number(req.body.cashPaid) || 0;
        req.body.paymentStatus = cashPaid >= grandTotal && grandTotal > 0 ? 'Paid' : (cashPaid > 0 ? 'Partially Paid' : 'Unpaid');
        if (cashPaid > 0 && !req.body.cashPaymentDateTime) {
          req.body.cashPaymentDateTime = new Date();
        }
      }

    // Ensure cashPaymentDateTime is set whenever cashPaid > 0, regardless of terms
    const anyCashPaid = Number(req.body.cashPaid) || 0;
    if (anyCashPaid > 0 && !req.body.cashPaymentDateTime) {
      req.body.cashPaymentDateTime = new Date();
    }
    } catch (calcErr) {
      console.warn('Payment status calc on update failed:', calcErr);
    }

    const updatedOrder = await PurchaseOrder.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!updatedOrder) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }
    // If order status transitioned to Received, add quantities to products once
    try {
      const becameReceived =
        (prevOrder.orderStatus || '').toLowerCase() !== 'received' &&
        (updatedOrder.orderStatus || '').toLowerCase() === 'received';

      if (becameReceived && Array.isArray(updatedOrder.items)) {
        for (const item of updatedOrder.items) {
          if (!item || !item.itemCode) continue;
          const product = await Product.findOne({ SKU: item.itemCode });
          if (!product) continue;

          const piecesPerCarton = Number(product.piecesPerCarton) || 0;
          const rawQty = Number(item.quantityOrdered) || 0;
          const uom = (item.uom || '').toString().toLowerCase();
          // Convert cartons/boxes to pieces if needed
          const receivedPieces =
            ['box', 'boxes', 'carton', 'cartons'].includes(uom) && piecesPerCarton > 0
              ? rawQty * piecesPerCarton
              : rawQty; // assume already in pieces

          const currentTotalPieces = Number(product.totalPieces) || ((Number(product.cartonQuantity) || 0) * (Number(product.piecesPerCarton) || 0)) + (Number(product.losePieces) || 0);
          const newTotalPieces = currentTotalPieces + receivedPieces;

          let newCartons = Number(product.cartonQuantity) || 0;
          let newLosePieces = Number(product.losePieces) || 0;

          if (piecesPerCarton > 0) {
            newCartons = Math.floor(newTotalPieces / piecesPerCarton);
            newLosePieces = newTotalPieces % piecesPerCarton;
          } else {
            // If piecesPerCarton not defined, just treat all as loose pieces
            newCartons = Number(product.cartonQuantity) || 0;
            newLosePieces = newTotalPieces;
          }

          const stockQuantity = newCartons + (newLosePieces > 0 ? 1 : 0);

          product.totalPieces = newTotalPieces;
          product.cartonQuantity = newCartons;
          product.losePieces = newLosePieces;
          product.stockQuantity = stockQuantity;

          // Recompute derived totals
          const costPerPiece = Number(product.costPerPiece) || 0;
          const sellingPerPiece = Number(product.sellingPerPiece) || 0;
          product.totalUnitCost = costPerPiece * newTotalPieces;
          product.perPieceProfit = sellingPerPiece - costPerPiece;
          product.totalUnitProfit = product.perPieceProfit * newTotalPieces;

          await product.save();
        }
      }
    } catch (invErr) {
      console.error('Inventory sync on PO Received failed:', invErr);
      // Do not fail the PO update due to inventory sync; report but continue
    }

    // If order is already Received and new items were added, restock only the new items
    try {
      const alreadyReceived = (updatedOrder.orderStatus || '').toLowerCase() === 'received';
      const newItems = req.body.newItems;

      if (alreadyReceived && Array.isArray(newItems) && newItems.length > 0) {
        for (const item of newItems) {
          if (!item || !item.itemCode) continue;
          const product = await Product.findOne({ SKU: item.itemCode });
          if (!product) continue;

          const piecesPerCarton = Number(product.piecesPerCarton) || 0;
          const rawQty = Number(item.quantityOrdered) || 0;
          const uom = (item.uom || '').toString().toLowerCase();
          const receivedPieces =
            ['box', 'boxes', 'carton', 'cartons'].includes(uom) && piecesPerCarton > 0
              ? rawQty * piecesPerCarton
              : rawQty;

          const currentTotalPieces = Number(product.totalPieces) || ((Number(product.cartonQuantity) || 0) * (Number(product.piecesPerCarton) || 0)) + (Number(product.losePieces) || 0);
          const newTotalPieces = currentTotalPieces + receivedPieces;

          let newCartons = Number(product.cartonQuantity) || 0;
          let newLosePieces = Number(product.losePieces) || 0;

          if (piecesPerCarton > 0) {
            newCartons = Math.floor(newTotalPieces / piecesPerCarton);
            newLosePieces = newTotalPieces % piecesPerCarton;
          } else {
            newCartons = Number(product.cartonQuantity) || 0;
            newLosePieces = newTotalPieces;
          }

          const stockQuantity = newCartons + (newLosePieces > 0 ? 1 : 0);

          product.totalPieces = newTotalPieces;
          product.cartonQuantity = newCartons;
          product.losePieces = newLosePieces;
          product.stockQuantity = stockQuantity;

          const costPerPiece = Number(product.costPerPiece) || 0;
          const sellingPerPiece = Number(product.sellingPerPiece) || 0;
          product.totalUnitCost = costPerPiece * newTotalPieces;
          product.perPieceProfit = sellingPerPiece - costPerPiece;
          product.totalUnitProfit = product.perPieceProfit * newTotalPieces;

          await product.save();
        }
      }
    } catch (newItemErr) {
      console.error('Inventory sync for new items on Received PO failed:', newItemErr);
      // Do not fail the PO update due to inventory sync
    }

    // Note: cashPaymentDateTime is handled above pre-update; no-op here

    res.json(updatedOrder);
  } catch (error) {
    console.error('Update error:', error);
    res.status(400).json({ 
      message: 'Failed to update purchase order', 
      error: error.message 
    });
  }
};

// Delete a purchase order
exports.delete = async (req, res) => {
  try {
    const order = await PurchaseOrder.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }
    res.json({ 
      message: 'Purchase order deleted successfully', 
      id: order._id 
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ 
      message: 'Failed to delete purchase order', 
      error: error.message 
    });
  }
};

exports.create = async (req, res) => {
  try {
    // Auto-generate PO Number if not provided
    if (!req.body.poNumber) {
      req.body.poNumber = 'PO-' + Date.now();
    }

    // Set default payment status if not provided
    if (!req.body.paymentStatus) {
      req.body.paymentStatus = 'Unpaid';
    }

    // Calculate totals if items are provided
    if (Array.isArray(req.body.items)) {
      let subtotal = 0, taxTotal = 0, discountTotal = 0;
      
      // Process each item
      req.body.items = req.body.items.map(item => {
        // Auto-calculate unitPrice if perPiecePrice and quantityOrdered are provided
        if (item.perPiecePrice && item.quantityOrdered) {
          item.unitPrice = Number(item.perPiecePrice) * Number(item.quantityOrdered);
        }
        
        const price = Number(item.unitPrice) || 0;
        const tax = Number(item.tax) || 0;
        const discount = Number(item.discount) || 0;
        
        // Calculate line total
        item.totalLineAmount = price + tax - discount;
        
        // Update running totals
        subtotal += price;
        taxTotal += tax;
        discountTotal += discount;
        
        return item;
      });
      
      // Calculate shipping charges (default to 0 if not provided)
      const shippingCharges = Number(req.body.shippingCharges) || 0;
      
      // Set calculated totals
      req.body.subtotal = subtotal;
      req.body.taxTotal = taxTotal;
      req.body.discountTotal = discountTotal;
      req.body.shippingCharges = shippingCharges;
      req.body.grandTotal = subtotal + taxTotal - discountTotal + shippingCharges;
      
      // Update payment status based on payment terms if needed
      if (req.body.paymentTerms === 'Advance Payment' && req.body.advanceAmount) {
        const advancePaid = Number(req.body.advanceAmount) || 0;
        req.body.paymentStatus = advancePaid >= req.body.grandTotal ? 'Paid' : 'Partially Paid';
        
        // Set the advance payment date and admin if not already set
        if (advancePaid > 0 && !req.body.advancePaymentDateTime) {
          req.body.advancePaymentDateTime = new Date();
        }
      } else if (req.body.paymentTerms === 'Partial Payment' && req.body.initialPayment) {
        const totalPaid = Number(req.body.initialPayment) + (Number(req.body.finalPayment) || 0);
        if (totalPaid >= req.body.grandTotal) {
          req.body.paymentStatus = 'Paid';
          // Set the final payment date if not already set
          if (!req.body.finalPaymentDateTime) {
            req.body.finalPaymentDateTime = new Date();
          }
        } else if (totalPaid > 0) {
          req.body.paymentStatus = 'Partially Paid';
          // Set the initial payment date if not already set
          if (!req.body.initialPaymentDateTime) {
            req.body.initialPaymentDateTime = new Date();
          }
        }
      } else if (req.body.paymentTerms === 'Cash Payment') {
        const cashPaid = Number(req.body.cashPaid) || 0;
        req.body.paymentStatus = cashPaid >= req.body.grandTotal ? 'Paid' : 'Partially Paid';
        if (cashPaid > 0 && !req.body.cashPaymentDateTime) {
          req.body.cashPaymentDateTime = new Date();
        }
      }

      // Ensure cashPaymentDateTime is set whenever cashPaid > 0, regardless of terms
      const anyCashPaidCreate = Number(req.body.cashPaid) || 0;
      if (anyCashPaidCreate > 0 && !req.body.cashPaymentDateTime) {
        req.body.cashPaymentDateTime = new Date();
      }
    }
    const order = new PurchaseOrder(req.body);
    await order.save();

    // If created as Received, immediately sync inventory
    try {
      if ((order.orderStatus || '').toLowerCase() === 'received' && Array.isArray(order.items)) {
        for (const item of order.items) {
          if (!item || !item.itemCode) continue;
          const product = await Product.findOne({ SKU: item.itemCode });
          if (!product) continue;

          const piecesPerCarton = Number(product.piecesPerCarton) || 0;
          const rawQty = Number(item.quantityOrdered) || 0;
          const uom = (item.uom || '').toString().toLowerCase();
          const receivedPieces =
            ['box', 'boxes', 'carton', 'cartons'].includes(uom) && piecesPerCarton > 0
              ? rawQty * piecesPerCarton
              : rawQty;

          const currentTotalPieces = Number(product.totalPieces) || ((Number(product.cartonQuantity) || 0) * (Number(product.piecesPerCarton) || 0)) + (Number(product.losePieces) || 0);
          const newTotalPieces = currentTotalPieces + receivedPieces;

          let newCartons = Number(product.cartonQuantity) || 0;
          let newLosePieces = Number(product.losePieces) || 0;

          if (piecesPerCarton > 0) {
            newCartons = Math.floor(newTotalPieces / piecesPerCarton);
            newLosePieces = newTotalPieces % piecesPerCarton;
          } else {
            newCartons = Number(product.cartonQuantity) || 0;
            newLosePieces = newTotalPieces;
          }

          const stockQuantity = newCartons + (newLosePieces > 0 ? 1 : 0);

          product.totalPieces = newTotalPieces;
          product.cartonQuantity = newCartons;
          product.losePieces = newLosePieces;
          product.stockQuantity = stockQuantity;

          const costPerPiece = Number(product.costPerPiece) || 0;
          const sellingPerPiece = Number(product.sellingPerPiece) || 0;
          product.totalUnitCost = costPerPiece * newTotalPieces;
          product.perPieceProfit = sellingPerPiece - costPerPiece;
          product.totalUnitProfit = product.perPieceProfit * newTotalPieces;

          await product.save();
        }
      }
    } catch (invErr) {
      console.error('Inventory sync on PO create (Received) failed:', invErr);
      // Continue without failing the create
    }

    res.status(201).json(order);
  } catch (error) {
    res.status(400).json({ message: 'Failed to create purchase order', error });
  }
};

exports.getAll = async (req, res) => {
  try {
    // Add filtering and sorting options
    const { status, vendorId, startDate, endDate, sortBy = 'poDate', sortOrder = 'desc' } = req.query;
    
    const filter = {};
    if (status) filter.orderStatus = status;
    if (vendorId) filter.vendorId = vendorId;
    
    // Date range filter
    if (startDate || endDate) {
      filter.poDate = {};
      if (startDate) filter.poDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.poDate.$lte = end;
      }
    }
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const orders = await PurchaseOrder.find(filter)
      .sort(sort)
      .populate('vendorId', 'vendorName contactPerson email phone');
    
    // Enhance orders with brand information for each item
    const enhancedOrders = await Promise.all(
      orders.map(async (order) => {
        if (order.items && order.items.length > 0) {
          const enhancedItems = await Promise.all(
            order.items.map(async (item) => {
              try {
                // Try to find product by itemCode (SKU) to get brand information
                const product = await Product.findOne({ SKU: item.itemCode });
                return {
                  ...item.toObject(),
                  brand: product ? product.brand : null,
                  category: product ? product.category : null,
                  vendor: product ? product.vendor : null
                };
              } catch (err) {
                console.warn(`Could not find product for itemCode: ${item.itemCode}`);
                return item.toObject();
              }
            })
          );
          
          const orderObj = order.toObject();
          orderObj.items = enhancedItems;
          return orderObj;
        }
        return order.toObject();
      })
    );
      
    res.json(enhancedOrders);
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({ 
      message: 'Failed to fetch purchase orders', 
      error: error.message 
    });
  }
};
