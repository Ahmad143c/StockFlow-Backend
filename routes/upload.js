const express = require('express');
const multer = require('multer');
const cloudinary = require('../utils/cloudinary');
const { auth } = require('../middleware/auth');
const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Upload endpoint for both admins and sellers (for payment proofs, product images, etc.)
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    
    // Determine resource type based on file mime type
    const isImage = req.file.mimetype.startsWith('image/');
    const isPDF = req.file.mimetype === 'application/pdf';
    const isDocument = req.file.mimetype.includes('document') || 
                       req.file.mimetype.includes('msword') || 
                       req.file.mimetype.includes('spreadsheet') ||
                       req.file.mimetype.includes('presentation');
    
    let resourceType = 'image'; // default
    if (isImage) {
      resourceType = 'image';
    } else if (isPDF || isDocument) {
      resourceType = 'raw'; // For PDFs and documents
    } else {
      resourceType = 'auto'; // Let Cloudinary decide
    }
    
    // Use a Promise to handle upload_stream
    const uploadToCloudinary = () => {
      return new Promise((resolve, reject) => {
        const uploadOptions = { 
          resource_type: resourceType,
          folder: 'inventory' // Organize uploads in a folder
        };
        
        const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
          if (error) return reject(error);
          resolve(result);
        });
        stream.end(req.file.buffer);
      });
    };
    const result = await uploadToCloudinary();
    res.json({ url: result.secure_url });
  } catch (err) {
    res.status(500).json({ message: 'File upload failed', error: err.message });
  }
});

module.exports = router;
