const { 
  User, 
  Student, 
  StudentParent, 
  Staff, 
  Section, 
  Class, 
  AcademicTerm, 
  sequelize 
} = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Helper to get section_id from request
 */
const getSectionId = (req) => {
  return req.headers['x-section-id'] || req.query.section_id;
};

/**
 * Helper to generate a temporary password
 */
const generateTempPassword = (length = 10) => {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
};

const isUuid = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

/**
 * Register a new student and associate with a parent
 * POST /api/proprietor/students
 */
exports.registerStudent = async (req, res) => {
  const { 
    first_name, 
    last_name, 
    admission_number, 
    class_id, 
    section_id, 
    profile_data,
    parent_email,
    parent_name,
    parent_phone
  } = req.body;

  const school_id = req.user.school_id ?? req.user.schoolId;
  const active_section_id = section_id || getSectionId(req);

  if (!first_name || !last_name || !parent_email) {
    return res.status(400).json({ message: 'First name, last name, and parent email are required.' });
  }

  if (!school_id) {
    return res.status(400).json({ message: 'School context is missing for this account.' });
  }

  let transaction;
  try {
    transaction = await sequelize.transaction();

    // 1. Check if parent exists
    let parent = await User.findOne({ where: { email: parent_email }, transaction });
    let parentIsNew = false;

    if (!parent) {
      // Create new parent user
      const tempPassword = generateTempPassword();
      parentIsNew = true;
      parent = await User.create({
        email: parent_email,
        name: parent_name || 'Parent',
        password: tempPassword, // Model hook will hash this
        role: 'parent',
        school_id: school_id,
        status: 'active',
        needs_password_reset: true
      }, { transaction });
    }

    // 2. Create student
    const student = await Student.create({
      first_name,
      last_name,
      admission_number,
      school_id,
      class_id,
      section_id: active_section_id,
      profile_data: profile_data || {}
    }, { transaction });

    // 3. Link student and parent via join table
    await StudentParent.create({
      student_id: student.id,
      parent_id: parent.id
    }, { transaction });

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: 'Student and parent registered successfully',
      student: {
        id: student.id,
        name: `${first_name} ${last_name}`,
        admission_number: student.admission_number
      },
      parent: {
        id: parent.id,
        email: parent.email,
        is_new: parentIsNew
      }
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    res.status(500).json({
      success: false,
      message: 'Failed to register student and parent.'
    });
  }
};

/**
 * Create a new staff member
 * POST /api/proprietor/staff
 */
exports.createStaff = async (req, res) => {
  const { 
    email, 
    name, 
    role, 
    salary, 
    qualifications, 
    active_section_id,
    role_permissions 
  } = req.body;

  const school_id = req.user.school_id ?? req.user.schoolId;

  if (!email || !name || !role) {
    return res.status(400).json({ message: 'Email, name, and role are required.' });
  }

  const validRoles = ['teacher', 'headmaster', 'cashier'];
  if (!validRoles.includes(role.toLowerCase())) {
    return res.status(400).json({ message: 'Invalid staff role. Must be teacher, headmaster, or cashier.' });
  }

  let transaction;
  try {
    transaction = await sequelize.transaction();

    // 1. Check if user already exists
    const existingUser = await User.findOne({ where: { email }, transaction });
    if (existingUser) {
      await transaction.rollback();
      return res.status(409).json({ message: 'User with this email already exists.' });
    }

    // 2. Create User record
    const tempPassword = generateTempPassword();
    const user = await User.create({
      email,
      name,
      password: tempPassword,
      role: 'staff',
      school_id,
      status: 'active',
      needs_password_reset: true
    }, { transaction });

    // 3. Create Staff profile
    const staff = await Staff.create({
      user_id: user.id,
      salary,
      qualifications,
      active_section_id,
      role_permissions: role_permissions || [role.toLowerCase()]
    }, { transaction });

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: 'Staff account created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        temp_password: tempPassword // In a real app, send via email
      },
      staff_id: staff.id
    });

  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('Error creating staff:', error);
    res.status(500).json({ message: 'Failed to create staff account.', error: error.message });
  }
};

/**
 * Get all staff members for the school
 * GET /api/proprietor/staff
 */
exports.getAllStaff = async (req, res) => {
  try {
    const school_id = req.user.school_id ?? req.user.schoolId;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const offset = (page - 1) * limit;

    const { rows: staff, count: total } = await User.findAndCountAll({
      where: { 
        school_id,
        role: 'staff'
      },
      include: [
        {
          model: Staff,
          as: 'staff_profile',
          include: [
            {
              model: Section,
              as: 'active_section',
              attributes: ['id', 'name']
            }
          ]
        }
      ],
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      count: staff.length,
      total,
      page,
      limit,
      staff
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve staff directory.'
    });
  }
};

/**
 * Create a new class
 * POST /api/proprietor/classes
 */
exports.createClass = async (req, res) => {
  const { name, section_id } = req.body;

  if (!name || !section_id) {
    return res.status(400).json({ message: 'Class name and section_id are required.' });
  }

  try {
    // Verify section belongs to the school
    const section = await Section.findOne({
      where: { id: section_id, school_id: req.user.school_id }
    });

    if (!section) {
      return res.status(404).json({ message: 'Section not found or does not belong to your school.' });
    }

    const newClass = await Class.create({
      name,
      section_id
    });

    res.status(201).json({
      success: true,
      message: 'Class created successfully',
      class: newClass
    });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ message: 'Failed to create class.', error: error.message });
  }
};

/**
 * Get classes filtered by section
 * GET /api/proprietor/classes
 */
exports.getClasses = async (req, res) => {
  try {
    const section_id = getSectionId(req);
    const school_id = req.user.school_id;

    // Build the query where clause
    const whereClause = {};
    let targetSectionId = section_id;

    if (targetSectionId && !isUuid(targetSectionId)) {
      const foundSection = await Section.findOne({
        where: {
          school_id,
          name: { [Op.iLike]: targetSectionId }
        }
      });
      if (foundSection) {
        targetSectionId = foundSection.id;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid section_id. Section not found.'
        });
      }
    }

    if (targetSectionId) {
      whereClause.section_id = targetSectionId;
    }

    const classes = await Class.findAll({
      where: whereClause,
      include: [{
        model: Section,
        as: 'section',
        where: { school_id: school_id },
        attributes: ['id', 'name']
      }],
      order: [['name', 'ASC']]
    });

    res.status(200).json({
      success: true,
      count: classes.length,
      classes
    });
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch classes due to a server error.', 
      error: error.message 
    });
  }
};

/**
 * Get all students filtered by section
 * GET /api/proprietor/students
 */
exports.getAllStudents = async (req, res) => {
  try {
    const section_id = getSectionId(req);
    const school_id = req.user.school_id ?? req.user.schoolId;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const offset = (page - 1) * limit;

    const whereClause = { school_id };
    let targetSectionId = section_id;

    if (targetSectionId && !isUuid(targetSectionId)) {
      const foundSection = await Section.findOne({
        where: {
          school_id,
          name: { [Op.iLike]: targetSectionId }
        }
      });
      if (foundSection) {
        targetSectionId = foundSection.id;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid section_id. Section not found.'
        });
      }
    }

    if (targetSectionId) {
      whereClause.section_id = targetSectionId;
    }

    const { rows: students, count: total } = await Student.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Class,
          as: 'class',
          attributes: ['id', 'name']
        },
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name']
        }
      ],
      order: [['first_name', 'ASC'], ['last_name', 'ASC']],
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      count: students.length,
      total,
      page,
      limit,
      students
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve student directory.'
    });
  }
};

/**
 * Get dashboard statistics filtered by section
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const school_id = req.user.school_id ?? req.user.schoolId;
    const section_id = getSectionId(req);

    const whereClause = { school_id };
    if (section_id) {
      whereClause.section_id = section_id;
    }

    const studentCount = await Student.count({ where: whereClause });
    const staffCount = await User.count({ where: { school_id, role: 'staff' } }).catch(() => null);

    res.status(200).json({
      message: 'Dashboard stats retrieved',
      stats: {
        total_students: studentCount,
        ...(staffCount !== null ? { total_staff: staffCount } : {}),
        active_section: section_id || 'All'
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve stats.' });
  }
};

/**
 * Academic Reports Stub
 */
exports.getAcademicReport = async (req, res) => {
  try {
    const section_id = getSectionId(req);
    // Stub logic for academic report summarizing headmaster submissions
    res.status(200).json({
      message: 'Academic report retrieved successfully',
      section_id: section_id || 'All',
      data: {
        summary: 'Academic performance summary stub',
        submissions: []
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve academic report.' });
  }
};

/**
 * Finance Reports Stub
 */
exports.getFinanceReport = async (req, res) => {
  try {
    const section_id = getSectionId(req);
    // Stub logic for finance report summarizing cashier collection metrics
    res.status(200).json({
      message: 'Finance report retrieved successfully',
      section_id: section_id || 'All',
      data: {
        total_collected: 0,
        pending_fees: 0,
        metrics: []
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve finance report.' });
  }
};

/**
 * Get Sections for the school
 */
exports.getSections = async (req, res) => {
  try {
    const sections = await Section.findAll({
      where: { school_id: req.user.school_id ?? req.user.schoolId }
    });
    res.status(200).json({ sections });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch sections.' });
  }
};

/**
 * Create Section
 */
exports.createSection = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Section name is required.' });
    }
    const section = await Section.create({
      name: String(name).trim(),
      school_id: req.user.school_id ?? req.user.schoolId
    });
    res.status(201).json({ section });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create section.' });
  }
};
