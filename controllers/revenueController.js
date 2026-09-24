const { RevenueLedger, School, sequelize } = require('../models');

/**
 * Record or update subscription payment for a school in the revenue ledger
 */
exports.recordPayment = async (req, res) => {
  try {
    const { school_id, amount_expected, amount_paid, notes } = req.body;

    if (!school_id || amount_expected === undefined || amount_paid === undefined) {
      return res.status(400).json({
        message: 'School ID, amount expected, and amount paid are required.'
      });
    }

    // Verify school exists
    const school = await School.findByPk(school_id);
    if (!school) {
      return res.status(404).json({
        message: 'School not found'
      });
    }

    // Check if a ledger record already exists for this school
    let ledgerItem = await RevenueLedger.findOne({
      where: { school_id }
    });

    if (ledgerItem) {
      // Update existing record
      ledgerItem.amount_expected = parseFloat(amount_expected);
      ledgerItem.amount_paid = parseFloat(amount_paid);
      if (notes !== undefined) ledgerItem.notes = notes;
      await ledgerItem.save();
    } else {
      // Create new record
      ledgerItem = await RevenueLedger.create({
        school_id,
        amount_expected: parseFloat(amount_expected),
        amount_paid: parseFloat(amount_paid),
        notes: notes || ''
      });
    }

    res.status(200).json({
      success: true,
      message: 'Revenue payment recorded successfully',
      ledger: ledgerItem
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to record payment'
    });
  }
};

/**
 * Get aggregated revenue summary (expected, collected, outstanding balance) across all schools
 */
exports.getRevenueSummary = async (req, res) => {
  try {
    const summary = await RevenueLedger.findOne({
      attributes: [
        [sequelize.fn('SUM', sequelize.col('amount_expected')), 'total_expected'],
        [sequelize.fn('SUM', sequelize.col('amount_paid')), 'total_paid'],
        [sequelize.fn('SUM', sequelize.col('balance_due')), 'total_outstanding']
      ],
      raw: true
    });

    res.status(200).json({
      success: true,
      summary: {
        total_expected: parseFloat(summary.total_expected || 0),
        total_paid: parseFloat(summary.total_paid || 0),
        total_outstanding: parseFloat(summary.total_outstanding || 0)
      }
    });
  } catch (error) {
    console.error('Error fetching revenue summary:', error);
    res.status(500).json({
      message: 'Failed to fetch revenue summary',
      error: error.message
    });
  }
};

/**
 * Get all ledger records with school details
 */
exports.getRevenueList = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const offset = (page - 1) * limit;

    const { rows: ledger, count: total } = await RevenueLedger.findAndCountAll({
      include: [
        {
          model: School,
          as: 'school',
          attributes: ['name']
        }
      ],
      order: [['updated_at', 'DESC']],
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      count: ledger.length,
      total,
      page,
      limit,
      ledger
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to fetch revenue ledger list'
    });
  }
};
