const { User, School, SubscriptionPlan } = require('../models');

/**
 * Bootstrap System - Initializes database with default School and Super Admin.
 * SAFE: never resets an existing admin password on boot. Credentials are only
 * applied on first creation; afterwards the DB is the source of truth.
 * Set BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD env vars to override defaults.
 */
async function bootstrapSystem() {
    try {
        const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || 'yunusabdulhameed1@gmail.com';
        const adminName = process.env.BOOTSTRAP_ADMIN_NAME || 'Yunus Abdulhamid';

        // 1. Ensure Main Academy School exists (atomic operation)
        const [school] = await School.findOrCreate({
            where: { name: 'FikrahTech Main Academy' },
            defaults: {
                name: 'FikrahTech Main Academy',
                is_blocked: false,
                current_session: '2024/2025',
                current_term: 'First Term'
            }
        });

        // 2. Create Super Admin ONLY if missing — never overwrite an existing password.
        const existing = await User.findOne({ where: { email: adminEmail } });
        let user = existing;
        if (!user) {
            const initialPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'Admin@123';
            user = await User.create({
                email: adminEmail,
                password: initialPassword, // User model hooks hash this
                role: 'super_admin',
                school_id: null,
                name: adminName
            });
        }

        // 3. Seed default subscription plans if table is empty
        const planCount = await SubscriptionPlan.count();
        if (planCount === 0) {
            await SubscriptionPlan.bulkCreate([
                { name: 'Basic', price: 5000.00, billing_cycle: 'termly', discount_amount: 0.00, features: JSON.stringify(['Up to 200 students', 'Basic reports']), is_active: true },
                { name: 'Pro', price: 12000.00, billing_cycle: 'termly', discount_amount: 500.00, features: JSON.stringify(['Up to 500 students', 'Advanced reports', 'SMS notifications']), is_active: true },
                { name: 'Enterprise', price: 25000.00, billing_cycle: 'session', discount_amount: 2000.00, features: JSON.stringify(['Unlimited students', 'Full feature access', 'Priority support']), is_active: true }
            ]);
        }

        return { success: true, school, user };
    } catch (error) {
        throw new Error('System bootstrap failed.');
    }
}

module.exports = { bootstrapSystem };
