const path = require('path');
const express = require('express');
const multer = require('multer');
const { uploadDir } = require('../config');

const storage = multer.diskStorage({
  destination: function destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function filename(req, file, cb) {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname) || '';
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({ storage });
const router = express.Router();

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { filename, path: filepath, mimetype, size } = req.file;
  return res.json({ filename, path: filepath, mimetype, size });
});

module.exports = router;


