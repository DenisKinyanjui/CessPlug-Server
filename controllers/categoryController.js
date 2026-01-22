const Category = require('../models/Category');
const mongoose = require('mongoose');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ status: 'active' })
      .populate('parent', 'name slug')
      .sort({ order: 1, name: 1 }); // Sort by order first, then name

    res.json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all categories for admin (including inactive)
// @route   GET /api/categories/admin/all
// @access  Private/Admin
exports.getAdminCategories = async (req, res) => {
  try {
    const { status, parent, search } = req.query;
    
    // Build filter object
    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    if (parent) {
      filter.parent = parent === 'null' ? null : parent;
    }
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const categories = await Category.find(filter)
      .populate('parent', 'name slug')
      .sort({ order: 1, name: 1 }); // Sort by order first, then name

    res.json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update categories order
// @route   PUT /api/categories/reorder
// @access  Private/Admin
exports.reorderCategories = async (req, res) => {
  try {
    const { categories } = req.body;

    if (!categories || !Array.isArray(categories)) {
      return res.status(400).json({
        success: false,
        message: 'Categories array is required'
      });
    }

    // Validate that all categories exist
    const categoryIds = categories.map(cat => cat.id);
    const existingCategories = await Category.find({ _id: { $in: categoryIds } });
    
    if (existingCategories.length !== categories.length) {
      return res.status(400).json({
        success: false,
        message: 'Some categories not found'
      });
    }

    // Prepare bulk operations
    const bulkOps = categories.map((category, index) => ({
      updateOne: {
        filter: { _id: category.id },
        update: { order: index + 1 }
      }
    }));

    // Execute bulk update
    await Category.bulkWrite(bulkOps);

    res.json({
      success: true,
      message: 'Categories reordered successfully'
    });
  } catch (error) {
    console.error('Reorder categories error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to reorder categories'
    });
  }
};

// @desc    Get category by ID
// @route   GET /api/categories/:id
// @access  Public
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('parent', 'name slug');

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({
      success: true,
      data: { category }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Helper function to validate parent category
const validateParentCategory = async (parentId, categoryId = null) => {
  if (!parentId) return true;
  
  if (!mongoose.Types.ObjectId.isValid(parentId)) {
    throw new Error('Invalid parent category ID');
  }
  
  const parentCategory = await Category.findById(parentId);
  if (!parentCategory) {
    throw new Error('Parent category not found');
  }
  
  if (parentCategory.status === 'inactive') {
    throw new Error('Cannot assign inactive parent category');
  }
  
  // Prevent circular reference
  if (categoryId && parentId === categoryId) {
    throw new Error('Category cannot be its own parent');
  }
  
  return true;
};

// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
exports.createCategory = async (req, res) => {
  try {
    const { 
      name, 
      slug, 
      parentCategory, 
      description, 
      image, 
      status, 
      commonSpecs 
    } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }
    
    if (!slug || !slug.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Slug is required'
      });
    }

    // Check if slug already exists
    const existingCategory = await Category.findOne({ slug: slug.toLowerCase() });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Slug already exists. Please choose a different slug.'
      });
    }

    // Validate parent category if provided
    if (parentCategory) {
      await validateParentCategory(parentCategory);
    }

    // Prepare category data
    const categoryData = {
      name: name.trim(),
      slug: slug.toLowerCase().trim(),
      description: description || '',
      image: image || '',
      parent: parentCategory || null,
      status: status || 'active',
      commonSpecs: commonSpecs || []
    };

    const category = await Category.create(categoryData);
    
    // Populate parent for response
    await category.populate('parent', 'name slug');

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: { category }
    });
  } catch (error) {
    console.error('Create category error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: errors.join('; ')
      });
    }
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Slug already exists. Please choose a different slug.'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create category'
    });
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      slug, 
      parentCategory, 
      description, 
      image, 
      status, 
      commonSpecs 
    } = req.body;

    // Check if category exists
    const existingCategory = await Category.findById(id);
    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Validate slug uniqueness if changed
    if (slug && slug !== existingCategory.slug) {
      const slugExists = await Category.findOne({ 
        slug: slug.toLowerCase(),
        _id: { $ne: id }
      });
      
      if (slugExists) {
        return res.status(400).json({
          success: false,
          message: 'Slug already exists. Please choose a different slug.'
        });
      }
    }

    // Validate parent category if provided
    if (parentCategory) {
      await validateParentCategory(parentCategory, id);
    }

    // Prepare update data
    const updateData = {};
    
    if (name !== undefined) updateData.name = name.trim();
    if (slug !== undefined) updateData.slug = slug.toLowerCase().trim();
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;
    if (status !== undefined) updateData.status = status;
    if (commonSpecs !== undefined) updateData.commonSpecs = commonSpecs;
    
    // Handle parent category (including null values)
    if (parentCategory !== undefined) {
      updateData.parent = parentCategory || null;
    }

    const category = await Category.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true,
        runValidators: true
      }
    ).populate('parent', 'name slug');

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: { category }
    });
  } catch (error) {
    console.error('Update category error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: errors.join('; ')
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update category'
    });
  }
};

// @desc    Delete category (HARD DELETE)
// @route   DELETE /api/categories/:id
// @access  Private/Admin
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if category has child categories
    const childCategories = await Category.find({ parent: id });
    if (childCategories.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category with subcategories. Please delete or reassign subcategories first.'
      });
    }

    // TODO: Add check for products using this category
    // You might want to add this check based on your Product model
    // const productsWithCategory = await Product.find({ category: id });
    // if (productsWithCategory.length > 0) {
    //   return res.status(400).json({
    //     success: false,
    //     message: `Cannot delete category. ${productsWithCategory.length} product(s) are using this category. Please reassign or delete those products first.`
    //   });
    // }

    // Hard delete - permanently remove from database
    await Category.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Category deleted permanently'
    });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to delete category'
    });
  }
};

// @desc    Get parent categories for dropdown
// @route   GET /api/categories/parents
// @access  Private/Admin
exports.getParentCategories = async (req, res) => {
  try {
    const categories = await Category.find({ 
      status: 'active',
      parent: null // Only root categories can be parents
    })
    .select('_id name slug')
    .sort({ order: 1, name: 1 }); // Sort by order first, then name

    res.json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get common specs for a category (for suggestions when creating products)
// @route   GET /api/categories/:id/common-specs
// @access  Private/Admin
exports.getCategoryCommonSpecs = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id).select('commonSpecs');
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({
      success: true,
      data: { commonSpecs: category.commonSpecs || [] }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};