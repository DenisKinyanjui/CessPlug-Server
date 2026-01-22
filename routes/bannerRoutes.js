const express = require('express');
const { getBanners } = require('../controllers/bannerController');

const router = express.Router();

// Public banner routes
router.get('/', getBanners);

module.exports = router;