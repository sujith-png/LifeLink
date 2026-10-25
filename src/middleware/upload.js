const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const uploadDir = path.resolve(__dirname, '../../uploads/requisitions');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Allowed extensions and MIME types
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

// Secure disk storage with unguessable server-side filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const rawExt = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt : '.bin';
    const uniqueToken = crypto.randomBytes(12).toString('hex');
    cb(null, `slip-${Date.now()}-${uniqueToken}${safeExt}`);
  }
});

// File filter checking extension and MIME type
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  if (ALLOWED_EXTENSIONS.includes(ext) && ALLOWED_MIME_TYPES.includes(mime)) {
    cb(null, true);
  } else {
    cb(
      new Error('Invalid file format. Only PDF, JPG, JPEG, and PNG files are allowed.'),
      false
    );
  }
};

const uploadRequisitionSlip = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB max
  },
  fileFilter
});

/**
 * Validates actual binary content (magic bytes) of uploaded files
 * Ensures users cannot rename .exe or scripts to .jpg or .pdf
 */
function validateDocumentContent(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, message: 'Uploaded file not found on disk.' };
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return { valid: false, message: 'Uploaded file is empty.' };
    }
    if (stat.size > 5 * 1024 * 1024) {
      return { valid: false, message: 'Uploaded file exceeds the 5 MB limit.' };
    }

    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    // PDF magic bytes: %PDF- (0x25 0x50 0x44 0x46)
    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;

    // JPEG magic bytes: 0xFF 0xD8 0xFF
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

    // PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4E &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0D &&
      buffer[5] === 0x0A &&
      buffer[6] === 0x1A &&
      buffer[7] === 0x0A;

    if (isPdf) return { valid: true, detectedType: 'application/pdf' };
    if (isJpeg) return { valid: true, detectedType: 'image/jpeg' };
    if (isPng) return { valid: true, detectedType: 'image/png' };

    return {
      valid: false,
      message: 'Invalid document content. File header does not match a valid PDF, JPG, or PNG document.'
    };
  } catch (err) {
    return { valid: false, message: `File validation failed: ${err.message}` };
  }
}

/**
 * Express middleware wrapper to catch Multer errors gracefully
 */
function handleRequisitionSlipUpload(req, res, next) {
  uploadRequisitionSlip.single('requisition_slip')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'The uploaded file exceeds the 5 MB size limit. Please upload a smaller document.'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid document file upload.'
      });
    }
    next();
  });
}

module.exports = {
  uploadRequisitionSlip,
  handleRequisitionSlipUpload,
  validateDocumentContent,
  uploadDir
};
