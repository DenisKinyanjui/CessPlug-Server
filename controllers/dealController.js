const Product = require('../models/Product');

// @desc    Get flash deals
// @route   GET /api/deals/flash
// @access  Public
exports.getFlashDeals = async (req, res) => {
  try {
    const products = await Product.find({
      isFlashDeal: true,
      flashEndsAt: { $gt: new Date() },
      isActive: true
    })
    .populate('brand', 'name slug logo')
    .populate('category', 'name slug')
    .sort({ flashEndsAt: 1 });

    // Transform products to FlashDeal structure with nested product
    const flashDeals = products.map(product => ({
      _id: product._id,
      product: {
        _id: product._id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        discount: product.discount,
        finalPrice: product.finalPrice,
        images: product.images,
        brand: product.brand,
        category: product.category,
        stock: product.stock,
        rating: product.rating,
        numReviews: product.numReviews,
        isFlashDeal: product.isFlashDeal,
        flashEndsAt: product.flashEndsAt,
        specifications: product.specifications,
        features: product.features,
        isActive: product.isActive,
        isNewArrival: product.isNewArrival,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      },
      discount: product.discount,
      flashEndsAt: product.flashEndsAt,
      isFlashDeal: true,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    }));

    res.json({
      success: true,
      data: { flashDeals }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create flash deal
// @route   POST /api/deals/flash
// @access  Private/Admin
exports.createFlashDeal = async (req, res) => {
  try {
    const { productId, discount, endsAt } = req.body;

    const product = await Product.findById(productId)
      .populate('brand', 'name slug logo')
      .populate('category', 'name slug');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    product.isFlashDeal = true;
    product.discount = discount;
    product.flashEndsAt = endsAt;

    await product.save();

    // Return in FlashDeal structure
    const flashDeal = {
      _id: product._id,
      product: {
        _id: product._id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        discount: product.discount,
        finalPrice: product.finalPrice,
        images: product.images,
        brand: product.brand,
        category: product.category,
        stock: product.stock,
        rating: product.rating,
        numReviews: product.numReviews,
        isFlashDeal: product.isFlashDeal,
        flashEndsAt: product.flashEndsAt,
        specifications: product.specifications,
        features: product.features,
        isActive: product.isActive,
        isNewArrival: product.isNewArrival,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      },
      discount: product.discount,
      flashEndsAt: product.flashEndsAt,
      isFlashDeal: true,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    };

    res.json({
      success: true,
      message: 'Flash deal created successfully',
      data: { product: flashDeal }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Remove flash deal
// @route   DELETE /api/deals/flash/:productId
// @access  Private/Admin
exports.removeFlashDeal = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    product.isFlashDeal = false;
    product.flashEndsAt = undefined;
    product.discount = 0;

    await product.save();

    res.json({
      success: true,
      message: 'Flash deal removed successfully',
      data: { product }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};