const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create storage engine for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: (req) => {
      // Use folder from body or query params, default to 'general_uploads'
      return req.body?.folder || req.query?.folder || 'general_uploads';
    },
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      return file.fieldname + '-' + uniqueSuffix;
    },
    transformation: [
      { width: 1200, height: 800, crop: 'limit' }, // Better size for banners
      { quality: 'auto' }
    ],
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif']
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('Error: Only images are allowed (jpeg, jpg, png, gif)'));
  }
};

// Initialize upload middleware
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilter
});

// Single file upload handler - changed field name to 'file' to match frontend
exports.uploadImage = upload.single('file');

// Multiple files upload handler
exports.uploadImages = upload.array('files', 5); // Max 5 files

// Controller function to handle upload response
exports.handleUpload = async (req, res) => {
  try {
    if (!req.file && !req.files) {
      return res.status(400).json({
        success: false,
        message: 'No files were uploaded'
      });
    }

    // Single file upload response
    if (req.file) {
      return res.status(200).json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          url: req.file.path,
          public_id: req.file.filename,
          secure_url: req.file.path.replace('http://', 'https://')
        }
      });
    }

    // Multiple files upload response
    if (req.files) {
      const files = req.files.map(file => ({
        url: file.path,
        public_id: file.filename,
        secure_url: file.path.replace('http://', 'https://')
      }));

      return res.status(200).json({
        success: true,
        message: 'Files uploaded successfully',
        data: files
      });
    }
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: err.message
    });
  }
};

// Delete image from Cloudinary
exports.deleteImage = async (req, res) => {
  try {
    const { public_id } = req.body;
    
    if (!public_id) {
      return res.status(400).json({
        success: false,
        message: 'No public_id provided'
      });
    }

    const result = await cloudinary.uploader.destroy(public_id);
    
    res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
      data: result
    });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({
      success: false,
      message: 'Delete failed',
      error: err.message
    });
  }
};