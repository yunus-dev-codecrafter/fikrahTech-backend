const { User, School, Payment, Student, StudentParent, Staff, Section, Class, AcademicSession, SchoolSettings, SubscriptionPlan, SchoolPlan, SchoolSubscription, RevenueLedger, sequelize } = require('../models');
const bcrypt = require('bcryptjs'); // For password hashing (though handled by model hook, good to have for clarity)

/**
 * Registers a new school and its first proprietor user.
 * This operation should be atomic (transactional).
 */
exports.registerSchool = async (req, res) => {
  const { 
    name, 
    email, 
    password, 
    current_session = '2026/2027', 
    current_term = 'First Term' 
  } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'School name, proprietor email, and password are required.' });
  }

  let transaction;
  try {
    console.log('🔍 REGISTRATION: Starting transaction...');
    transaction = await sequelize.transaction();

    // 1. Create the School entry
    console.log('🔍 REGISTRATION: Creating school with name:', name);
    let newSchool;
    let schoolId;
    try {
      newSchool = await School.create({
        name: name,
        is_blocked: false, // New schools are not blocked by default
        status: 'active',
        trial_period_days: 30
      }, { transaction });
      console.log('🔍 REGISTRATION: School created with ID:', newSchool.id);
      schoolId = (newSchool && (typeof newSchool.id === 'string' ? newSchool.id : (newSchool.get ? newSchool.get('id') : String(newSchool.id))));
    } catch (error) {
      console.error('🔍 REGISTRATION ERROR - Step 1 (School creation):', error.message);
      throw error;
    }

    // 3. Create the first Proprietor User - The User model hook will handle hashing the password
    console.log('🔍 REGISTRATION: Creating user with email:', email, 'for school:', schoolId);
    try {
      await User.create({
        school_id: schoolId,
        email: email,
        password: password, // Pass plain password, let model hook hash it
        role: 'proprietor'
      }, { transaction });
      console.log('🔍 REGISTRATION: User created successfully');
    } catch (error) {
      console.error('🔍 REGISTRATION ERROR - Step 3 (User creation):', error.message);
      throw error;
    }

    // 4. Create academic_sessions entry for the school
    console.log('🔍 REGISTRATION: Creating academic session...');
    try {
      await AcademicSession.create({
        school_id: schoolId,
        name: current_session,
        is_current: true
      }, { transaction });
      console.log('🔍 REGISTRATION: Academic session created');
    } catch (error) {
      console.error('🔍 REGISTRATION ERROR - Step 4 (Academic session creation):', error.message);
      console.log('🔍 REGISTRATION: Continuing without academic session...');
      // Don't throw error - allow registration to continue even if session creation fails
    }

    // 5. Create school_settings entry with default values
    console.log('🔍 REGISTRATION: Creating school settings...');
    try {
      await SchoolSettings.create({
        school_id: schoolId,
        current_session: current_session,
        current_term: current_term,
        currency: 'NGN',
        timezone: 'Africa/Lagos',
        grading_system: '5.0',
        max_students: null
      }, { transaction });
      console.log('🔍 REGISTRATION: School settings created');
    } catch (error) {
      console.error('🔍 REGISTRATION ERROR - Step 5 (School settings creation):', error.message);
      throw error;
    }

    console.log('🔍 REGISTRATION: Committing transaction...');
    await transaction.commit();
    console.log('🔍 REGISTRATION: Transaction committed successfully');

    res.status(201).json({
      message: 'School and proprietor registered successfully.',
      school: {
        id: newSchool.id,
        name: newSchool.name,
        is_blocked: newSchool.is_blocked
      }
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('REGISTRATION_FLOW_ERROR:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ message: 'School name or proprietor email already exists.' });
    }
    res.status(500).json({ 
      message: 'Failed to register school and proprietor.', 
      error: error.message 
    });
  }
};

/**
 * Toggles the `is_blocked` status for a given school.
 */
exports.toggleBlockSchool = async (req, res) => {
  const { schoolId } = req.params; // Get school ID from URL parameters

  try {
    const school = await School.findByPk(schoolId);

    if (!school) {
      return res.status(404).json({ message: 'School not found.' });
    }

    school.is_blocked = !school.is_blocked; // Toggle the status
    await school.save();

    res.status(200).json({
      message: `School '${school.name}' block status updated successfully.`,
      school: {
        id: school.id,
        name: school.name,
        is_blocked: school.is_blocked
      }
    });
  } catch (error) {
    console.error('Error toggling school block status:', error);
    res.status(500).json({ message: 'Failed to update school block status.' });
  }
};

/**
 * Adds days to a school's subscription expiry date
 * Super Admin only endpoint
 */
exports.updateSchoolSubscription = async (req, res) => {
  const { schoolId } = req.params;
  const { days, action } = req.body; // days: number, action: 'extend' or 'set'

  if (!days || days <= 0) {
    return res.status(400).json({ 
      message: 'Valid number of days is required.' 
    });
  }

  if (!action || !['extend', 'set'].includes(action)) {
    return res.status(400).json({ 
      message: 'Action must be either "extend" or "set".' 
    });
  }

  try {
    const school = await School.findByPk(schoolId);

    if (!school) {
      return res.status(404).json({ message: 'School not found.' });
    }

    let newExpiryDate;
    const currentDate = new Date();

    if (action === 'extend') {
      // Extend from current expiry date (or current date if no expiry)
      const baseDate = school.subscriptionExpiry ? new Date(school.subscriptionExpiry) : currentDate;
      newExpiryDate = new Date(baseDate);
      newExpiryDate.setDate(newExpiryDate.getDate() + days);
    } else if (action === 'set') {
      // Set expiry from current date
      newExpiryDate = new Date(currentDate);
      newExpiryDate.setDate(newExpiryDate.getDate() + days);
    }

    // Update school subscription
    await school.update({
      subscriptionExpiry: newExpiryDate,
      status: 'active' // Reset status to active when subscription is updated
    });

    console.log(`📅 SUBSCRIPTION UPDATED: School ${school.name} - ${action} ${days} days - New expiry: ${newExpiryDate}`);

    res.status(200).json({
      message: `School subscription ${action}ed successfully by ${days} days.`,
      school: {
        id: school.id,
        name: school.name,
        status: school.status,
        subscriptionExpiry: school.subscriptionExpiry,
        trialPeriodDays: school.trialPeriodDays
      }
    });
  } catch (error) {
    console.error('Error updating school subscription:', error);
    res.status(500).json({ message: 'Failed to update school subscription.' });
  }
};

/**
 * Get all schools for Super Admin dashboard
 */
exports.getAllSchools = async (req, res) => {
  try {
    // Optional pagination + search (backward compatible: no params = all schools, capped at 200)
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 200);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const where = search
      ? {
          [require('sequelize').Op.or]: [
            { name: { [require('sequelize').Op.iLike]: `%${search}%` } },
          ],
        }
      : undefined;

    const { rows: schools, count: total } = await School.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'users',
          where: { role: 'proprietor' },
          required: false,
          attributes: ['id', 'email']
        },
        {
          model: SchoolSettings,
          as: 'settings',
          required: false
        },
        {
          model: SchoolSubscription,
          as: 'subscriptions',
          required: false,
          include: [
            {
              model: SubscriptionPlan,
              as: 'plan',
              required: false,
              attributes: ['id', 'name', 'price', 'billing_cycle']
            }
          ],
          attributes: ['id', 'start_date', 'expiry_date', 'status', 'plan_id']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    // Transform the response to match expected format
    const transformedSchools = schools.map(school => {
      const schoolJson = school.toJSON();
      const proprietor = schoolJson.users && schoolJson.users[0];
      const latestSubscription = schoolJson.subscriptions && schoolJson.subscriptions[0];

      return {
        ...schoolJson,
        proprietor_email: proprietor?.email || null,
        proprietor_id: proprietor?.id || null,
        users: undefined, // Remove the users array from response
        start_date: latestSubscription?.start_date || null,
        expiry_date: latestSubscription?.expiry_date || null,
        plan_name: latestSubscription?.plan?.name || null,
        plan_price: latestSubscription?.plan?.price || null,
        subscription_status: latestSubscription?.status || null
      };
    });

    res.status(200).json({
      message: 'Schools retrieved successfully',
      count: transformedSchools.length,
      total,
      page,
      limit,
      schools: transformedSchools
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch schools.'
    });
  }
};

/**
 * Get single school details for Super Admin
 */
exports.getSchoolById = async (req, res) => {
  try {
    const { id } = req.params;

    const school = await School.findByPk(id, {
      include: [
        {
          model: User,
          as: 'users',
          where: { role: 'proprietor' },
          required: false
        },
        {
          model: SchoolSettings,
          as: 'settings'
        }
      ]
    });

    if (!school) {
      return res.status(404).json({ message: 'School not found.' });
    }

    const schoolJson = school.toJSON();
    schoolJson.proprietor_email = schoolJson.users?.[0]?.email || null;
    schoolJson.proprietor_id = schoolJson.users?.[0]?.id || null;
    delete schoolJson.users;

    res.status(200).json({
      message: 'School retrieved successfully',
      school: schoolJson,
      settings: schoolJson.settings
    });
  } catch (error) {
    console.error('Error fetching school:', error);
    res.status(500).json({ message: 'Failed to retrieve school.' });
  }
};

/**
 * Update school details (Super Admin only)
 */
exports.updateSchool = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    phone,
    address,
    city,
    state,
    country,
    current_session,
    current_term,
    is_blocked,
    proprietor_email,
    email
  } = req.body;

  const targetEmail = proprietor_email || email;

  let transaction;
  try {
    transaction = await sequelize.transaction();

    // Partial update only: never overwrite provided fields with null,
    // and never change is_blocked unless explicitly sent.
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (country !== undefined) updates.country = country;
    if (current_session !== undefined) updates.current_session = current_session;
    if (current_term !== undefined) updates.current_term = current_term;
    if (is_blocked !== undefined) updates.is_blocked = !!is_blocked;

    if (Object.keys(updates).length === 0 && !targetEmail) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    // Use Sequelize School.update to handle PostgreSQL Boolean and UUID values correctly
    const [affectedRows] = await School.update(updates, {
      where: { id },
      transaction
    });

    if (affectedRows === 0) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'No school found matching that ID.' });
    }

    // Explicitly update proprietor user email if provided using User.update
    if (targetEmail) {
      await User.update({
        email: targetEmail
      }, {
        where: {
          school_id: id,
          role: 'proprietor'
        },
        transaction
      });
    }

    await transaction.commit();

    // Fetch the updated school with proprietor user and settings
    const updatedSchool = await School.findByPk(id, {
      include: [
        {
          model: User,
          as: 'users',
          where: { role: 'proprietor' },
          required: false
        },
        {
          model: SchoolSettings,
          as: 'settings'
        }
      ]
    });

    const schoolJson = updatedSchool.toJSON();
    schoolJson.proprietor_email = schoolJson.users?.[0]?.email || null;
    delete schoolJson.users;

    res.status(200).json({
      success: true,
      message: 'School updated successfully',
      school: schoolJson
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    return res.status(500).json({
      message: 'Failed to update school.'
    });
  }
};

/**
 * Delete school (Super Admin only)
 * Includes dependent deletion of all linked records to avoid foreign key constraints
 */
exports.deleteSchool = async (req, res) => {
  const { id } = req.params;
  let transaction;

  try {
    const school = await School.findByPk(id);

    if (!school) {
      return res.status(404).json({ message: 'School not found.' });
    }

    // Start transaction for atomic deletion
    transaction = await sequelize.transaction();

    // 1. Delete associated users
    await User.destroy({ where: { school_id: id }, transaction });

    // 2. Delete associated school settings
    await SchoolSettings.destroy({ where: { school_id: id }, transaction });

    // 3. Delete associated academic sessions
    await AcademicSession.destroy({ where: { school_id: id }, transaction });

    // 4. Delete associated payments (must be before students if there are constraints)
    await Payment.destroy({ where: { school_id: id }, transaction });

    // 5. Delete associated students
    await Student.destroy({ where: { school_id: id }, transaction });

    // 6. Delete associated revenue ledger records
    await RevenueLedger.destroy({ where: { school_id: id }, transaction });

    // 7. Delete associated subscriptions
    await SchoolSubscription.destroy({ where: { school_id: id }, transaction });

    // 8. Delete associated school plans
    await SchoolPlan.destroy({ where: { school_id: id }, transaction });

    // 9. Delete classes via their sections (scoped to this school only),
    // then staff, then sections. Order matters for FK constraints.
    const schoolSections = await Section.findAll({
      where: { school_id: id },
      attributes: ['id'],
      transaction,
    }).catch(() => []);
    const sectionIds = (schoolSections || []).map((s) => s.id).filter(Boolean);
    if (sectionIds.length > 0) {
      await Class.destroy({ where: { section_id: sectionIds }, transaction }).catch(() => null);
    }
    await Staff.destroy({ where: { school_id: id }, transaction }).catch(() => null);
    // Sections belong to the school — remove last to satisfy class FKs first
    await Section.destroy({ where: { school_id: id }, transaction }).catch(() => null);

    // 10. Finally, delete the school itself
    await school.destroy({ transaction });

    await transaction.commit();

    res.status(200).json({
      message: 'School and all associated records deleted successfully'
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    return res.status(500).json({
      message: 'Failed to delete school due to database constraints or other error.'
    });
  }
};

exports.getAllSessions = async (req, res) => {
  try {
    console.log('🔍 SESSIONS: Fetching school session overview...');

    // 1. Fetch sessions including the School model with a left join (required: false)
    const sessionRecords = await AcademicSession.findAll({
      include: [
        {
          model: School,
          as: 'school',
          required: false // 👈 CRITICAL: Prevents breaking if user has no school (super_admin)
        }
      ]
    });

    // 2. Secure the response mapping loop using optional chaining (?.) and safe fallbacks
    const sessions = sessionRecords.map(session => ({
      school_id: session.school?.id || session.school_id || null,
      school_name: session.school?.name || 'System / Platform Wide',
      status: session.school?.status || 'Inactive',
      current_session_name: session.name || 'Not Started',
      current_term_name: session.school?.current_term || 'Not Set',
      current_session: session.name || 'Not Started',
      current_term: session.school?.current_term || 'Not Set',
      active_session_record: session.name || null,
      active_session_id: session.id || null
    }));

    console.log('🔍 SESSIONS: Fetched successfully:', sessions.length, 'sessions');

    res.status(200).json({
      message: 'Sessions retrieved successfully',
      count: sessions.length,
      sessions
    });
  } catch (error) {
    console.error('🔍 SESSIONS ERROR: Failed to fetch sessions:', error);
    res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get Super Admin dashboard statistics
 */
exports.getAdminStats = async (req, res) => {
  try {
    console.log('🔍 ADMIN STATS: Starting stats collection...');
    
    const { School, Payment, Student } = require('../models');
    console.log('🔍 ADMIN STATS: Models loaded successfully');

    // Get total schools count (handle empty table)
    console.log('🔍 ADMIN STATS: Querying schools table...');
    const totalSchools = await School.count().catch((err) => {
      console.error('🔍 ADMIN STATS ERROR: Failed to query schools table:', err);
      return 0;
    });
    console.log('🔍 ADMIN STATS: Schools count:', totalSchools);

    // Get total revenue from payments (return 0 if Payment model doesn't exist)
    console.log('🔍 ADMIN STATS: Checking Payment model availability...');
    let totalRevenue = 0;
    if (Payment && typeof Payment.sum === 'function') {
      console.log('🔍 ADMIN STATS: Querying payments table...');
      totalRevenue = await Payment.sum('amount').catch((err) => {
        console.error('🔍 ADMIN STATS ERROR: Failed to query payments table:', err);
        return 0;
      }) || 0;
    } else {
      console.log('🔍 ADMIN STATS: Payment model not available, revenue set to 0');
    }
    console.log('🔍 ADMIN STATS: Total revenue:', totalRevenue);

    // Get total students count (handle empty table)
    console.log('🔍 ADMIN STATS: Querying students table...');
    const totalStudents = await Student.count().catch((err) => {
      console.error('🔍 ADMIN STATS ERROR: Failed to query students table:', err);
      return 0;
    });
    console.log('🔍 ADMIN STATS: Students count:', totalStudents);

    console.log('🔍 ADMIN STATS: Stats collection completed successfully');
    res.status(200).json({
      message: 'Admin statistics retrieved successfully',
      stats: {
        totalSchools,
        totalRevenue,
        totalStudents
      }
    });
  } catch (error) {
    console.error('🔍 ADMIN STATS CRITICAL ERROR:', error);
    console.error('🔍 ADMIN STATS ERROR STACK:', error.stack);
    res.status(500).json({
      message: 'Failed to retrieve statistics',
      error: error.message,
      stack: error.stack
    });
  }
};

/**
 * Get role-specific settings
 */
exports.getSettings = async (req, res) => {
  try {
    const role = req.user.role.toLowerCase();

    if (role === 'super_admin') {
      // Super Admin sees System Settings
      res.status(200).json({
        message: 'System settings retrieved successfully',
        settings: {
          type: 'system',
          saasName: 'FikrahTech SaaS Platform',
          maintenanceMode: false,
          version: '1.0.0',
          totalUsers: await User.count(),
          maxSchools: 1000
        }
      });
    } else if (role === 'proprietor') {
      // Proprietor sees School Settings
      const schoolId = req.user.schoolId;
      const school = await School.findByPk(schoolId, {
        include: [{
          model: SchoolSettings,
          as: 'settings'
        }]
      });

      if (!school) {
        return res.status(404).json({ message: 'School not found.' });
      }

      res.status(200).json({
        message: 'School settings retrieved successfully',
        settings: {
          type: 'school',
          schoolName: school.name,
          schoolLogo: school.settings?.schoolLogo || null,
          currentSession: school.settings?.current_session || '2023/2024',
          currentTerm: school.settings?.current_term || 'First Term'
        }
      });
    } else {
      res.status(403).json({
        message: 'Access denied. Invalid role.',
        debug: 'INVALID_ROLE'
      });
    }
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ message: 'Failed to retrieve settings.' });
  }
};

/**
 * Update school settings (Super Admin only)
 */
exports.updateSchoolSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { currentSession, currentTerm } = req.body;

    if (!currentSession && !currentTerm) {
      return res.status(400).json({
        message: 'At least one of currentSession or currentTerm is required'
      });
    }

    // Find the school
    const school = await School.findByPk(id);
    if (!school) {
      return res.status(404).json({
        message: 'School not found'
      });
    }

    // Find or create school settings
    let settings = await SchoolSettings.findOne({
      where: { school_id: id }
    });

    if (!settings) {
      settings = await SchoolSettings.create({
        school_id: id,
        current_session: currentSession || '2023/2024',
        current_term: currentTerm || 'First Term'
      });
    } else {
      // Update existing settings
      await settings.update({
        current_session: currentSession || settings.current_session,
        current_term: currentTerm || settings.current_term
      });
    }

    res.status(200).json({
      message: 'School settings updated successfully',
      settings: {
        schoolId: id,
        currentSession: settings.current_session,
        currentTerm: settings.current_term
      }
    });
  } catch (error) {
    console.error('Error updating school settings:', error);
    res.status(500).json({ message: 'Failed to update school settings.' });
  }
};

/**
 * Get all subscription plans for Super Admin
 */
exports.getPlans = async (req, res) => {
  try {
    console.log('🔍 PLANS: Fetching all subscription plans...');
    const plans = await SubscriptionPlan.findAll({ order: [['price', 'ASC']] });
    
    const plansWithParsedFeatures = plans.map(plan => {
      let parsedFeatures = [];
      try {
        parsedFeatures = typeof plan.features === 'string' ? JSON.parse(plan.features) : (plan.features || []);
      } catch (e) {
        console.error('Error parsing features for plan:', plan.id, e);
        parsedFeatures = [];
      }
      return {
        id: plan.id,
        name: plan.name,
        price: parseFloat(plan.price),
        billing_cycle: plan.billing_cycle,
        discount_amount: parseFloat(plan.discount_amount),
        features: parsedFeatures,
        is_active: plan.is_active,
        created_at: plan.created_at,
        updated_at: plan.updated_at
      };
    });
    
    console.log('🔍 PLANS: Plans fetched successfully:', plansWithParsedFeatures.length);
    
    res.status(200).json({ 
      success: true, 
      plans: plansWithParsedFeatures 
    });
  } catch (error) {
    console.error('🔍 PLANS ERROR: Failed to fetch plans:', error);
    res.status(200).json({ 
      success: true, 
      plans: [] 
    }); // Return empty array to prevent frontend crash
  }
};

/**
 * Create a new subscription plan (Super Admin only)
 */
exports.createPlan = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    console.log('🔍 PLANS: Creating new subscription plan inside transaction...');
    
    // 1. Destructure the updated structural data payload from frontend
    const { 
      name, 
      price, 
      interval, 
      billing_cycle, 
      discount_amount, 
      features, 
      schoolIds, 
      startDate, 
      endDate 
    } = req.body;

    const cycle = billing_cycle || interval;

    if (!name || price === undefined || !cycle) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'Plan name, price, and billing cycle (or interval) are required.' 
      });
    }

    // Validate cycle/interval options and map to valid billing cycles ('monthly', 'termly', 'session')
    let mappedCycle = cycle.toLowerCase();
    if (mappedCycle === 'yearly') {
      mappedCycle = 'session';
    }

    const validCycles = ['monthly', 'termly', 'session'];
    if (!validCycles.includes(mappedCycle)) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'Billing cycle must be one of: monthly, termly, or session.' 
      });
    }

    // If schoolIds are provided, validate timeline bounds (start_date, end_date)
    if (schoolIds && Array.isArray(schoolIds) && schoolIds.length > 0) {
      if (!startDate || !endDate) {
        await transaction.rollback();
        return res.status(400).json({
          message: 'Both start date and end date are required when associating schools.'
        });
      }
    }

    // 2. Build the base architectural plan entity
    const plan = await SubscriptionPlan.create({
      name,
      price: parseFloat(price),
      billing_cycle: mappedCycle,
      discount_amount: discount_amount ? parseFloat(discount_amount) : 0.00,
      features: features ? (typeof features === 'string' ? features : JSON.stringify(features)) : '[]',
      is_active: true
    }, { transaction });

    // 3. Process the explicit school mappings if provided
    if (schoolIds && Array.isArray(schoolIds) && schoolIds.length > 0) {
      const linkages = schoolIds.map(schoolId => ({
        plan_id: plan.id,
        school_id: schoolId,
        start_date: startDate,
        end_date: endDate
      }));

      await SchoolPlan.bulkCreate(linkages, { transaction });
    }

    await transaction.commit();
    console.log('🔍 PLANS: Plan and associated school mappings created successfully with ID:', plan.id);
    
    // Parse features if they are stringified
    let parsedFeatures = [];
    if (features) {
      parsedFeatures = typeof features === 'string' ? JSON.parse(features) : features;
    }

    return res.status(201).json({
      message: 'Subscription plan created successfully.',
      plan: {
        id: plan.id,
        name: plan.name,
        price: parseFloat(plan.price),
        billing_cycle: plan.billing_cycle,
        discount_amount: parseFloat(plan.discount_amount),
        features: parsedFeatures,
        is_active: plan.is_active
      }
    });

  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('❌ Error in plan creation controller:', error);
    return res.status(500).json({ 
      message: 'Failed to create subscription plan alignment.',
      error: error.message 
    });
  }
};

/**
 * Assign a subscription plan to a school
 */
exports.assignSubscriptionToSchool = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { planId, plan_id, startDate, start_date, expiryDate, expiry_date, status } = req.body;

    const final_plan_id = planId || plan_id;
    const final_start_date = startDate || start_date;
    const final_expiry_date = expiryDate || expiry_date;
    const final_status = status || 'active';

    if (!final_plan_id) {
      return res.status(400).json({ message: 'Plan ID (planId or plan_id) is required.' });
    }
    if (!final_start_date) {
      return res.status(400).json({ message: 'Start date (startDate or start_date) is required.' });
    }
    if (!final_expiry_date) {
      return res.status(400).json({ message: 'Expiry date (expiryDate or expiry_date) is required.' });
    }

    // Verify school exists
    const school = await School.findByPk(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found.' });
    }

    // Verify plan exists
    const plan = await SubscriptionPlan.findByPk(final_plan_id);
    if (!plan) {
      return res.status(404).json({ message: 'Subscription plan not found.' });
    }

    // Implement upsert: find existing subscription for this school
    let subscription = await SchoolSubscription.findOne({
      where: { school_id: schoolId }
    });

    if (subscription) {
      // Update existing subscription
      await subscription.update({
        plan_id: final_plan_id,
        start_date: final_start_date,
        expiry_date: final_expiry_date,
        status: final_status
      });
    } else {
      // Create new subscription
      subscription = await SchoolSubscription.create({
        school_id: schoolId,
        plan_id: final_plan_id,
        start_date: final_start_date,
        expiry_date: final_expiry_date,
        status: final_status
      });
    }

    // Update school's subscription expiry and status
    await school.update({
      subscription_expiry: final_expiry_date,
      status: 'active'
    });

    res.status(201).json({
      message: 'Subscription assigned to school successfully.',
      subscription: {
        id: subscription.id,
        school_id: subscription.school_id,
        plan_id: subscription.plan_id,
        start_date: subscription.start_date,
        expiry_date: subscription.expiry_date,
        status: subscription.status
      }
    });
  } catch (error) {
    console.error('Error assigning subscription:', error);
    res.status(500).json({ 
      message: 'Failed to assign subscription.', 
      error: error.message 
    });
  }
};

/**
 * Get all school subscriptions
 */
exports.getSchoolSubscriptions = async (req, res) => {
  try {
    const { SchoolSubscription } = require('../models');

    const subscriptions = await SchoolSubscription.findAll({
      include: [
        {
          model: School,
          as: 'school',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: SubscriptionPlan,
          as: 'plan',
          attributes: ['id', 'name', 'price', 'billing_cycle'],
          required: false
        }
      ],
      order: [['created_at', 'DESC']]
    });

    // Transform the response to match expected format
    const transformedSubscriptions = subscriptions.map(sub => {
      const subJson = sub.toJSON();
      return {
        ...subJson,
        school_name: subJson.school?.name || null,
        plan_name: subJson.plan?.name || null,
        plan_price: subJson.plan?.price || null,
        plan_interval: subJson.plan?.billing_cycle || null
      };
    });

    res.status(200).json({
      message: 'School subscriptions retrieved successfully',
      count: transformedSubscriptions.length,
      subscriptions: transformedSubscriptions
    });
  } catch (error) {
    console.error('Error fetching school subscriptions:', error);
    res.status(500).json({ message: 'Failed to retrieve school subscriptions.', error: error.message });
  }
};

/**
 * Update a subscription plan (Super Admin only)
 */
exports.updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, billing_cycle, interval, discount_amount, features } = req.body;

    const plan = await SubscriptionPlan.findByPk(id);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    
    if (price !== undefined) {
      updateData.price = price !== null ? parseFloat(price) : 0.00;
    }

    const cycle = billing_cycle || interval;
    if (cycle !== undefined) {
      let mappedCycle = cycle.toLowerCase();
      if (mappedCycle === 'yearly') {
        mappedCycle = 'session';
      }
      const validCycles = ['monthly', 'termly', 'session'];
      if (!validCycles.includes(mappedCycle)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Billing cycle must be one of: monthly, termly, or session.' 
        });
      }
      updateData.billing_cycle = mappedCycle;
    }

    if (discount_amount !== undefined) {
      updateData.discount_amount = discount_amount !== null ? parseFloat(discount_amount) : 0.00;
    }

    if (features !== undefined) {
      let finalFeatures = '[]';
      if (features === null || features === '') {
        finalFeatures = '[]';
      } else if (typeof features === 'string') {
        try {
          const parsed = JSON.parse(features);
          finalFeatures = typeof parsed === 'string' ? JSON.stringify([parsed]) : JSON.stringify(parsed);
        } catch (e) {
          finalFeatures = JSON.stringify([features]);
        }
      } else if (Array.isArray(features)) {
        finalFeatures = JSON.stringify(features);
      } else {
        finalFeatures = JSON.stringify([features]);
      }
      updateData.features = finalFeatures;
    }

    console.log('🔄 PLANS: Updating subscription plan', id, 'with details:', updateData);
    await plan.update(updateData);

    // Prepare clean response object with parsed features
    let parsedFeaturesResponse = [];
    try {
      parsedFeaturesResponse = typeof plan.features === 'string' ? JSON.parse(plan.features) : (plan.features || []);
    } catch (e) {
      parsedFeaturesResponse = [];
    }

    return res.status(200).json({ 
      success: true, 
      data: {
        id: plan.id,
        name: plan.name,
        price: parseFloat(plan.price),
        billing_cycle: plan.billing_cycle,
        discount_amount: parseFloat(plan.discount_amount),
        features: parsedFeaturesResponse,
        is_active: plan.is_active,
        created_at: plan.created_at,
        updated_at: plan.updated_at
      }
    });
  } catch (error) {
    console.error('❌ Error updating plan:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Delete a subscription plan (Super Admin only)
 */
exports.deletePlan = async (req, res) => {
  try {
    const { id } = req.params;

    const plan = await SubscriptionPlan.findByPk(id);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    await plan.destroy();
    return res.status(200).json({ success: true, message: 'Plan removed successfully' });
  } catch (error) {
    console.error('❌ Error deleting plan:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Reset User Password to a temporary fallback password and force rotation (Super Admin only)
 */
exports.resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Generate a human-readable temporary password: FikrahTemp! + 4 random digits
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const tempPassword = `FikrahTemp!${randomDigits}`;

    // Update targeted user's password and needs_password_reset
    // User model hooks will hash it
    user.password = tempPassword;
    user.needs_password_reset = true;
    await user.save();

    console.log(`🔍 ADMIN OVERRIDE: Reset password for user ${user.email} to temporary password: ${tempPassword}`);

    return res.status(200).json({
      message: 'Password reset successfully.',
      temporaryPassword: tempPassword
    });
  } catch (error) {
    console.error('❌ Error resetting password:', error);
    return res.status(500).json({ message: 'Failed to reset password due to server error.', error: error.message });
  }
};