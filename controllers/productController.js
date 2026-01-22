const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Review = require('../models/Review');
const mongoose = require('mongoose');

// Helper function to convert category slug/id to ObjectId
const getCategoryId = async (categoryParam) => {
  if (!categoryParam) return null;
  
  try {
    if (mongoose.Types.ObjectId.isValid(categoryParam)) {
      return new mongoose.Types.ObjectId(categoryParam);
    } else {
      const category = await Category.findOne({ slug: categoryParam });
      return category ? category._id : null;
    }
  } catch (error) {
    console.error('Error in getCategoryId:', error);
    return null;
  }
};

// Helper function to convert brand slug/id to ObjectId
const getBrandId = async (brandParam) => {
  if (!brandParam) return null;
  
  try {
    if (mongoose.Types.ObjectId.isValid(brandParam)) {
      return new mongoose.Types.ObjectId(brandParam);
    } else {
      const brand = await Brand.findOne({ 
        $or: [
          { slug: brandParam },
          { name: { $regex: new RegExp(`^${brandParam}$`, 'i') } }
        ]
      });
      return brand ? brand._id : null;
    }
  } catch (error) {
    console.error('Error in getBrandId:', error);
    return null;
  }
};

// Helper function to handle multiple brand IDs
const getBrandIds = async (brandParam) => {
  if (!brandParam) return null;
  
  try {
    // Handle comma-separated brand values
    const brandValues = brandParam.split(',').map(b => b.trim()).filter(Boolean);
    const brandIds = [];
    
    for (const brandValue of brandValues) {
      const brandId = await getBrandId(brandValue);
      if (brandId) {
        brandIds.push(brandId);
      }
    }
    
    return brandIds.length > 0 ? brandIds : null;
  } catch (error) {
    console.error('Error in getBrandIds:', error);
    return null;
  }
};

// Helper function for fuzzy search scoring
const calculateFuzzyScore = (searchTerm, productName) => {
  const search = searchTerm.toLowerCase();
  const name = productName.toLowerCase();
  
  // Exact match - highest score
  if (name === search) return 100;
  
  // Starts with search term - very high score
  if (name.startsWith(search)) return 90;
  
  // Contains search term - high score
  if (name.includes(search)) return 80;
  
  // Word boundary match (e.g., "phone" matches "Smart Phone")
  const words = name.split(/\s+/);
  const searchWords = search.split(/\s+/);
  
  let wordMatchScore = 0;
  for (const searchWord of searchWords) {
    for (const word of words) {
      if (word.startsWith(searchWord)) {
        wordMatchScore += 70;
      } else if (word.includes(searchWord)) {
        wordMatchScore += 50;
      }
    }
  }
  
  if (wordMatchScore > 0) return wordMatchScore / searchWords.length;
  
  // Partial character matching (for typos)
  let matchCount = 0;
  let searchIndex = 0;
  
  for (let i = 0; i < name.length && searchIndex < search.length; i++) {
    if (name[i] === search[searchIndex]) {
      matchCount++;
      searchIndex++;
    }
  }
  
  const partialScore = (matchCount / search.length) * 40;
  return partialScore;
};

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    // Build query
    let query = {};
    
    // IMPORTANT: Only filter by isActive if activeOnly is explicitly set
    if (req.query.activeOnly === 'true') {
      query.isActive = true;
    }
    
    // FUZZY SEARCH IMPLEMENTATION
    let fuzzySearchActive = false;
    let searchProducts = [];
    
    if (req.query.search) {
      const searchTerm = decodeURIComponent(req.query.search.trim());
      const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // First, try exact and partial regex matching
      const searchQuery = {
        $or: [
          { name: { $regex: escapedTerm, $options: 'i' } },
          { description: { $regex: escapedTerm, $options: 'i' } },
          { tags: { $regex: escapedTerm, $options: 'i' } }
        ]
      };
      
      // Merge with existing query
      const tempQuery = { ...query, ...searchQuery };
      
      // Get initial results with regex
      const initialResults = await Product.find(tempQuery)
        .populate('brand', 'name slug logo')
        .populate('category', 'name slug')
        .lean();
      
      // If we have results, use them
      if (initialResults.length > 0) {
        searchProducts = initialResults;
        fuzzySearchActive = true;
      } else {        
        const baseQuery = { ...query };
        const allProducts = await Product.find(baseQuery)
          .populate('brand', 'name slug logo')
          .populate('category', 'name slug')
          .lean();
        
        // Calculate fuzzy scores for all products
        const scoredProducts = allProducts
          .map(product => ({
            ...product,
            _fuzzyScore: calculateFuzzyScore(searchTerm, product.name)
          }))
          .filter(product => product._fuzzyScore > 30) // Minimum threshold
          .sort((a, b) => b._fuzzyScore - a._fuzzyScore);
        
        if (scoredProducts.length > 0) {
          searchProducts = scoredProducts;
          fuzzySearchActive = true;
        }
      }
      
      // Update query to only include found product IDs if we have results
      if (fuzzySearchActive && searchProducts.length > 0) {
        query._id = { $in: searchProducts.map(p => p._id) };
      } else if (fuzzySearchActive && searchProducts.length === 0) {
        // No products found even with fuzzy search
        return res.json({
          success: true,
          data: {
            products: [],
            pagination: { page, limit, total: 0, pages: 0 }
          }
        });
      }
    }

    // Category filter
    if (req.query.category) {
      const categoryParam = decodeURIComponent(req.query.category.trim());
      const categoryId = await getCategoryId(categoryParam);
      if (categoryId) {
        query.category = categoryId;
      } else {
        return res.json({
          success: true,
          data: {
            products: [],
            pagination: { page, limit, total: 0, pages: 0 }
          }
        });
      }
    }

    // Brand filter
    if (req.query.brand) {
      const brandParam = decodeURIComponent(req.query.brand.trim());
      const brandIds = await getBrandIds(brandParam);
      if (brandIds && brandIds.length > 0) {
        query.brand = brandIds.length === 1 ? brandIds[0] : { $in: brandIds };
      } else {
        return res.json({
          success: true,
          data: {
            products: [],
            pagination: { page, limit, total: 0, pages: 0 }
          }
        });
      }
    }

    // Price range
    if (req.query.minPrice || req.query.maxPrice) {
      query.price = {};
      if (req.query.minPrice) {
        const minPrice = Number(req.query.minPrice);
        if (!isNaN(minPrice)) {
          query.price.$gte = minPrice;
        }
      }
      if (req.query.maxPrice) {
        const maxPrice = Number(req.query.maxPrice);
        if (!isNaN(maxPrice)) {
          query.price.$lte = maxPrice;
        }
      }
    }

    // Flash deals
    if (req.query.flashDeals === 'true') {
      query.isFlashDeal = true;
      query.flashEndsAt = { $gt: new Date() };
    }

    // Featured products
    if (req.query.featured === 'true') {
      query.isFeatured = true;
    }

    // New arrivals
    if (req.query.newArrivals === 'true') {
      query.isNewArrival = true;
    }

    // Best sellers
    if (req.query.bestSellers === 'true') {
      query.isBestSeller = true;
    }

    // Status filter
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Dynamic specs filtering
    const reservedParams = [
      'page', 'limit', 'search', 'category', 'brand', 'minPrice', 'maxPrice',
      'flashDeals', 'featured', 'newArrivals', 'bestSellers', 'status', 'sortBy', 'activeOnly'
    ];
    
    const specFilters = [];
    Object.keys(req.query).forEach(key => {
      if (!reservedParams.includes(key)) {
        let rawValue = req.query[key];
        if (!rawValue || rawValue === '') return;
        
        try {
          let decodedValue;
          try {
            decodedValue = decodeURIComponent(rawValue);
          } catch (decodeError) {
            decodedValue = rawValue;
          }
          
          const trimmedValue = decodedValue.trim();
          
          if (trimmedValue !== '') {
            specFilters.push({
              specifications: {
                $elemMatch: {
                  name: { $regex: new RegExp(`^${escapeRegex(key)}$`, 'i') },
                  value: { $regex: new RegExp(`^${escapeRegex(trimmedValue)}$`, 'i') }
                }
              }
            });
          }
        } catch (error) {
          console.error(`Error processing spec filter ${key}:`, error);
        }
      }
    });

    if (specFilters.length > 0) {
      query.$and = query.$and || [];
      query.$and.push(...specFilters);
    }

    // Sort
    let sortBy = {};
    if (fuzzySearchActive && searchProducts.length > 0) {
      // For fuzzy search, we'll sort manually by score later
      sortBy = {};
    } else if (req.query.sortBy) {
      switch (req.query.sortBy) {
        case 'price_low':
          sortBy.price = 1;
          break;
        case 'price_high':
          sortBy.price = -1;
          break;
        case 'rating':
          sortBy.rating = -1;
          break;
        case 'newest':
          sortBy.createdAt = -1;
          break;
        default:
          sortBy.createdAt = -1;
      }
    } else {
      sortBy.createdAt = -1;
    }


    let products;
    
    if (fuzzySearchActive && searchProducts.length > 0) {
      // Filter searchProducts by additional query criteria
      let filteredProducts = searchProducts;
      
      // Apply category filter
      if (query.category) {
        filteredProducts = filteredProducts.filter(p => 
          p.category._id.toString() === query.category.toString()
        );
      }
      
      // Apply brand filter
      if (query.brand) {
        if (Array.isArray(query.brand.$in)) {
          filteredProducts = filteredProducts.filter(p => 
            query.brand.$in.some(brandId => p.brand._id.toString() === brandId.toString())
          );
        } else {
          filteredProducts = filteredProducts.filter(p => 
            p.brand._id.toString() === query.brand.toString()
          );
        }
      }
      
      // Apply price filter
      if (query.price) {
        if (query.price.$gte) {
          filteredProducts = filteredProducts.filter(p => p.price >= query.price.$gte);
        }
        if (query.price.$lte) {
          filteredProducts = filteredProducts.filter(p => p.price <= query.price.$lte);
        }
      }
      
      // Apply sorting if requested
      if (req.query.sortBy) {
        switch (req.query.sortBy) {
          case 'price_low':
            filteredProducts.sort((a, b) => a.price - b.price);
            break;
          case 'price_high':
            filteredProducts.sort((a, b) => b.price - a.price);
            break;
          case 'rating':
            filteredProducts.sort((a, b) => b.rating - a.rating);
            break;
          case 'newest':
            filteredProducts.sort((a, b) => 
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            break;
        }
      }
      // Otherwise keep fuzzy score sorting
      
      const total = filteredProducts.length;
      products = filteredProducts.slice(skip, skip + limit);
      
      // Remove fuzzy score from response
      products = products.map(p => {
        const { _fuzzyScore, ...product } = p;
        return product;
      });
      
      return res.json({
        success: true,
        data: {
          products,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } else {
      // Normal database query
      products = await Product.find(query)
        .sort(sortBy)
        .skip(skip)
        .limit(limit)
        .populate('brand', 'name slug logo')
        .populate('category', 'name slug');

      const total = await Product.countDocuments(query);

      res.json({
        success: true,
        data: {
          products,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    }
  } catch (error) {
    console.error('Error in getProducts:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error fetching products'
    });
  }
};

// Helper function to escape regex special characters
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// @desc    Get products for admin (including inactive) - UPDATED WITH BETTER PAGINATION
// @route   GET /api/admin/products
// @access  Private/Admin
exports.getAdminProducts = async (req, res) => {
  try {

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    // Status filter
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    // Category filter
    if (req.query.category) {
      if (mongoose.Types.ObjectId.isValid(req.query.category)) {
        filter.category = req.query.category;
      } else {
        const category = await Category.findOne({ slug: req.query.category });
        if (category) {
          filter.category = category._id;
        } else {
          return res.json({
            success: true,
            data: {
              products: [],
              pagination: { page, limit, total: 0, pages: 0 }
            }
          });
        }
      }
    }
    
    // Brand filter
    if (req.query.brand) {
      if (mongoose.Types.ObjectId.isValid(req.query.brand)) {
        filter.brand = req.query.brand;
      } else {
        const brand = await Brand.findOne({ 
          $or: [
            { slug: req.query.brand },
            { name: { $regex: new RegExp(`^${req.query.brand}$`, 'i') } }
          ]
        });
        if (brand) {
          filter.brand = brand._id;
        } else {
          return res.json({
            success: true,
            data: {
              products: [],
              pagination: { page, limit, total: 0, pages: 0 }
            }
          });
        }
      }
    }
    
    // Search filter
    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      filter.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    // Sort
    let sortBy = {};
    if (req.query.sortBy) {
      switch (req.query.sortBy) {
        case 'name':
          sortBy.name = 1;
          break;
        case 'price_low':
          sortBy.price = 1;
          break;
        case 'price_high':
          sortBy.price = -1;
          break;
        case 'newest':
          sortBy.createdAt = -1;
          break;
        case 'oldest':
          sortBy.createdAt = 1;
          break;
        case 'stock_low':
          sortBy.stock = 1;
          break;
        case 'stock_high':
          sortBy.stock = -1;
          break;
        default:
          sortBy.createdAt = -1;
      }
    } else {
      sortBy.createdAt = -1;
    }

    const products = await Product.find(filter)
      .sort(sortBy)
      .skip(skip)
      .limit(limit)
      .populate('brand', 'name slug logo')
      .populate('category', 'name slug');

    const total = await Product.countDocuments(filter);
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page,
          limit,
          total,
          pages
        }
      }
    });
  } catch (error) {
    console.error('Error in getAdminProducts:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Get single product by slug
// @route   GET /api/products/slug/:slug
// @access  Public
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
      .populate('brand', 'name slug logo')
      .populate('category', 'name slug');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: { product }
    });
  } catch (error) {
    console.error('Error in getProduct:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single product by ID
// @route   GET /api/products/:id
// @access  Public
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('brand', 'name slug logo')
      .populate('category', 'name slug');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: { product }
    });
  } catch (error) {
    console.error('Error in getProductById:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create product
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
  try {
    // Add the admin user ID to the request body
    req.body.createdBy = req.user.id;
    
    // Handle specs - ensure it's an object
    if (req.body.specs) {
      if (typeof req.body.specs === 'string') {
        try {
          req.body.specs = JSON.parse(req.body.specs);
        } catch (parseError) {
          return res.status(400).json({
            success: false,
            message: 'Invalid specs format. Must be a valid JSON object.'
          });
        }
      }
      
      // Validate specs format
      if (typeof req.body.specs !== 'object' || Array.isArray(req.body.specs)) {
        return res.status(400).json({
          success: false,
          message: 'Specs must be an object with key-value pairs'
        });
      }
    } else {
      req.body.specs = {};
    }

    // Convert specifications object to the correct format if needed (backward compatibility)
    if (req.body.specifications && typeof req.body.specifications === 'object') {
      // Keep specifications as is for backward compatibility
    }

    // Ensure status is set to active if not provided
    if (!req.body.status) {
      req.body.status = 'active';
    }

    // Set isActive based on status
    req.body.isActive = req.body.status === 'active';

    const product = await Product.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: { product }
    });
  } catch (error) {
    console.error('Error in createProduct:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Product with this slug already exists'
      });
    }

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res) => {
  try {
    // Handle specs - ensure it's an object
    if (req.body.specs !== undefined) {
      if (typeof req.body.specs === 'string') {
        try {
          req.body.specs = JSON.parse(req.body.specs);
        } catch (parseError) {
          return res.status(400).json({
            success: false,
            message: 'Invalid specs format. Must be a valid JSON object.'
          });
        }
      }
      
      // Validate specs format
      if (req.body.specs !== null && 
          (typeof req.body.specs !== 'object' || Array.isArray(req.body.specs))) {
        return res.status(400).json({
          success: false,
          message: 'Specs must be an object with key-value pairs'
        });
      }
    }

    // Set isActive based on status if status is being updated
    if (req.body.status) {
      req.body.isActive = req.body.status === 'active';
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    ).populate('brand', 'name slug logo')
     .populate('category', 'name slug');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: { product }
    });
  } catch (error) {
    console.error('Error in updateProduct:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Product with this slug already exists'
      });
    }

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if hard delete was requested
    const hardDelete = req.query.hard === 'true';

    if (hardDelete) {
      // Perform hard delete
      await product.remove();
    } else {
      // Perform soft delete (default)
      product.isActive = false;
      product.status = 'inactive';
      await product.save();
    }

    res.json({
      success: true,
      message: `Product ${hardDelete ? 'permanently deleted' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Error in deleteProduct:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Add this function to your productController.js

// @desc    Get new arrival products
// @route   GET /api/products/new-arrivals
// @access  Public
exports.getNewArrivals = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    
    // Build query for new arrivals
    const query = { 
      isActive: true,
      isNewArrival: true 
    };

    const products = await Product.find(query)
      .sort({ createdAt: -1 }) // Sort by newest first
      .limit(limit)
      .populate('brand', 'name slug logo')
      .populate('category', 'name slug');

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page: 1,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error in getNewArrivals:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error fetching new arrivals'
    });
  }
};

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
exports.getFeaturedProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    
    // Build query for featured products
    const query = { 
      isActive: true,
      isFeatured: true 
    };

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('brand', 'name slug logo')
      .populate('category', 'name slug');

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page: 1,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error in getFeaturedProducts:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error fetching featured products'
    });
  }
};

// @desc    Get popular products
// @route   GET /api/products/popular
// @access  Public
exports.getPopularProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    
    // Build query for popular products (you can modify this logic based on your needs)
    const query = { 
      isActive: true 
    };

    const products = await Product.find(query)
      .sort({ 
        rating: -1,      // Sort by rating first
        numReviews: -1,  // Then by number of reviews
        createdAt: -1    // Finally by creation date
      })
      .limit(limit)
      .populate('brand', 'name slug logo')
      .populate('category', 'name slug');

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page: 1,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error in getPopularProducts:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error fetching popular products'
    });
  }
};

// @desc    Get unique spec values for filtering
// @route   GET /api/products/specs/:specName
// @access  Public
exports.getSpecValues = async (req, res) => {
  try {
    const { specName } = req.params;
    const { category, brand, includeCount, activeOnly } = req.query;

    // Build match criteria
    const matchCriteria = {};
    
    // Only filter by active products if activeOnly is true
    if (activeOnly === 'true') {
      matchCriteria.isActive = true;
    }
    
    if (category) {
      const categoryId = await getCategoryId(category);
      if (categoryId) {
        matchCriteria.category = categoryId;
      } else {
        // Category not found, return empty values
        return res.json({
          success: true,
          data: { 
            specName,
            values: []
          }
        });
      }
    }
    
    if (brand) {
      const brandId = await getBrandId(brand);
      if (brandId) {
        matchCriteria.brand = brandId;
      } else {
        // Brand not found, return empty values
        return res.json({
          success: true,
          data: { 
            specName,
            values: []
          }
        });
      }
    }

    // Build aggregation pipeline
    const pipeline = [
      { $match: matchCriteria },
      { 
        $project: { 
          specValue: `$specifications.${specName}` 
        } 
      },
      { 
        $match: { 
          specValue: { $exists: true, $ne: null, $ne: "" } 
        } 
      }
    ];

    if (includeCount === 'true') {
      // Include count for each value
      pipeline.push(
        { 
          $group: { 
            _id: "$specValue",
            count: { $sum: 1 }
          } 
        },
        { 
          $sort: { 
            _id: 1 
          } 
        },
        {
          $project: {
            _id: 0,
            value: "$_id",
            count: 1
          }
        }
      );
    } else {
      // Just get unique values
      pipeline.push(
        { 
          $group: { 
            _id: "$specValue" 
          } 
        },
        { 
          $sort: { 
            _id: 1 
          } 
        },
        {
          $project: {
            _id: 0,
            value: "$_id"
          }
        }
      );
    }

    const values = await Product.aggregate(pipeline);

    res.json({
      success: true,
      data: { 
        specName,
        values: includeCount === 'true' ? values : values.map(v => v.value)
      }
    });
  } catch (error) {
    console.error('Error in getSpecValues:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all specifications for filtering
// @route   GET /api/products/specs
// @access  Public
exports.getAllSpecs = async (req, res) => {
  try {
    const { category, brand, includeCount, activeOnly, productIds } = req.query;
    const matchCriteria = {};

    if (activeOnly === 'true') {
      matchCriteria.isActive = true;
    }

    if (productIds) {
      try {
        const idsArray = productIds.split(',').map(id => id.trim()).filter(Boolean);
        const objectIds = idsArray.map(id => new mongoose.Types.ObjectId(id));
        matchCriteria._id = { $in: objectIds };
      } catch (error) {
        console.error('Error parsing product IDs:', error);
        return res.status(400).json({
          success: false,
          message: 'Invalid product IDs format'
        });
      }
    } else {
      if (category) {
        const categoryId = await getCategoryId(category);
        if (categoryId) {
          matchCriteria.category = categoryId;
        } else {
          return res.json({ success: true, data: { specs: [] } });
        }
      }

      if (brand) {
        const brandId = await getBrandId(brand);
        if (brandId) {
          matchCriteria.brand = brandId;
        } else {
          return res.json({ success: true, data: { specs: [] } });
        }
      }
    }

    // FIXED: Updated aggregation pipeline to match the correct data structure
    const pipeline = [
      { $match: matchCriteria },
      // Unwind the specifications array
      { $unwind: "$specifications" },
      // Filter out empty or null specifications
      {
        $match: {
          "specifications.name": { $exists: true, $ne: null, $ne: "" },
          "specifications.value": { $exists: true, $ne: null, $ne: "" }
        }
      }
    ];

    if (includeCount === 'true') {
      // Include count for each spec value
      pipeline.push(
        {
          $group: {
            _id: {
              name: "$specifications.name",
              value: "$specifications.value"
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: "$_id.name",
            values: {
              $push: {
                value: "$_id.value",
                count: "$count"
              }
            }
          }
        },
        {
          $project: {
            _id: 0,
            name: "$_id",
            values: 1
          }
        },
        { $sort: { name: 1 } }
      );
    } else {
      // Just get unique values without counts
      pipeline.push(
        {
          $group: {
            _id: "$specifications.name",
            values: { $addToSet: "$specifications.value" }
          }
        },
        {
          $project: {
            _id: 0,
            name: "$_id",
            values: 1
          }
        },
        { $sort: { name: 1 } }
      );
    }

    const specs = await Product.aggregate(pipeline);

    // Clean up the results
    const cleanedSpecs = specs.map(spec => ({
      name: spec.name,
      values: includeCount === 'true' 
        ? spec.values.filter(v => v.value && v.value.trim() !== '')
        : spec.values.filter(v => v && v.trim() !== '')
    })).filter(spec => spec.values.length > 0);

    res.json({
      success: true,
      data: { 
        specs: cleanedSpecs
      }
    });
  } catch (error) {
    console.error("Error in getAllSpecs:", error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Get all brands with product counts
// @route   GET /api/products/brands
// @access  Public
exports.getAllBrands = async (req, res) => {
  try {
    const { category, activeOnly, productIds } = req.query;

    // Build match criteria for products
    const matchCriteria = {};
    
    // Only filter by active products if activeOnly is true
    if (activeOnly === 'true') {
      matchCriteria.isActive = true;
    }
    
    // If productIds are provided, filter by those specific products
    if (productIds) {
      try {
        const idsArray = productIds.split(',').map(id => id.trim()).filter(Boolean);
        const objectIds = idsArray.map(id => new mongoose.Types.ObjectId(id));
        matchCriteria._id = { $in: objectIds };
      } catch (error) {
        console.error('Error parsing product IDs:', error);
        return res.status(400).json({
          success: false,
          message: 'Invalid product IDs format'
        });
      }
    } else {
      // Fallback to category filtering if no specific product IDs
      if (category) {
        const categoryId = await getCategoryId(category);
        if (categoryId) {
          matchCriteria.category = categoryId;
        } else {
          return res.json({
            success: true,
            data: { brands: [] }
          });
        }
      }
    }

    // Get brands with product counts using proper aggregation
    const brandCounts = await Product.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: "$brand",
          productCount: { $sum: 1 }
        }
      },
      {
        $match: {
          _id: { $ne: null } // Exclude products without brands
        }
      }
    ]);

    // Get brand details with proper population
    const brandIds = brandCounts.map(b => b._id).filter(id => id);
    
    if (brandIds.length === 0) {
      return res.json({
        success: true,
        data: { brands: [] }
      });
    }

    const brands = await Brand.find({ 
      _id: { $in: brandIds },
      isActive: true // Only include active brands
    }).select('_id name slug logo');


    // Combine brand details with counts
    const brandsWithCounts = brands.map(brand => {
      const countData = brandCounts.find(b => 
        b._id && b._id.toString() === brand._id.toString()
      );
      return {
        _id: brand._id,
        name: brand.name,
        slug: brand.slug,
        logo: brand.logo,
        productCount: countData ? countData.productCount : 0
      };
    }).filter(brand => brand.productCount > 0);

    // Sort by name
    brandsWithCounts.sort((a, b) => a.name.localeCompare(b.name));


    res.json({
      success: true,
      data: { brands: brandsWithCounts }
    });
  } catch (error) {
    console.error('Error in getAllBrands:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get price range for products
// @route   GET /api/products/price-range
// @access  Public
exports.getPriceRange = async (req, res) => {
  try {
    const { category, brand, activeOnly } = req.query;

    // Build match criteria
    const matchCriteria = {};
    
    // Only filter by active products if activeOnly is true
    if (activeOnly === 'true') {
      matchCriteria.isActive = true;
    }
    
    if (category) {
      const categoryId = await getCategoryId(category);
      if (categoryId) {
        matchCriteria.category = categoryId;
      } else {
        // Category not found, return default range
        return res.json({
          success: true,
          data: { 
            minPrice: 0,
            maxPrice: 0
          }
        });
      }
    }
    
    if (brand) {
      const brandId = await getBrandId(brand);
      if (brandId) {
        matchCriteria.brand = brandId;
      } else {
        // Brand not found, return default range
        return res.json({
          success: true,
          data: { 
            minPrice: 0,
            maxPrice: 0
          }
        });
      }
    }


    // Get price range
    const priceRange = await Product.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: null,
          minPrice: { $min: "$price" },
          maxPrice: { $max: "$price" }
        }
      }
    ]);

    const result = priceRange.length > 0 ? priceRange[0] : { minPrice: 0, maxPrice: 0 };


    res.json({
      success: true,
      data: {
        minPrice: result.minPrice || 0,
        maxPrice: result.maxPrice || 0
      }
    });
  } catch (error) {
    console.error('Error in getPriceRange:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get product statistics for admin dashboard
// @route   GET /api/admin/products/stats
// @access  Private/Admin
exports.getProductStats = async (req, res) => {
  try {

    // Use aggregation for better performance
    const stats = await Product.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
            }
          },
          inactive: {
            $sum: {
              $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0]
            }
          },
          lowStock: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$stock', 0] }, { $lt: ['$stock', 20] }] },
                1,
                0
              ]
            }
          },
          outOfStock: {
            $sum: {
              $cond: [{ $eq: ['$stock', 0] }, 1, 0]
            }
          },
          featured: {
            $sum: {
              $cond: [{ $eq: ['$isFeatured', true] }, 1, 0]
            }
          },
          newArrivals: {
            $sum: {
              $cond: [{ $eq: ['$isNewArrival', true] }, 1, 0]
            }
          },
          bestSellers: {
            $sum: {
              $cond: [{ $eq: ['$isBestSeller', true] }, 1, 0]
            }
          }
        }
      }
    ]);

    const result = stats[0] || {
      total: 0,
      active: 0,
      inactive: 0,
      lowStock: 0,
      outOfStock: 0,
      featured: 0,
      newArrivals: 0,
      bestSellers: 0
    };

    // Remove the _id field
    delete result._id;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error in getProductStats:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};
