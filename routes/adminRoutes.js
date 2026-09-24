const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const revenueController = require('../controllers/revenueController');

// NOTE: authentication + admin role are already enforced in routes/index.js
// (router.use('/admin', verifyToken, isAdmin)). Do NOT re-apply verifyToken
// here — that caused 2-3x DB lookups per admin request.

// Route for Super Admin to register a new school and its first proprietor
router.post('/schools/register', adminController.registerSchool);

// Route for Super Admin to create a new school (simplified endpoint)
router.post('/schools', adminController.registerSchool);

// Route for Super Admin to toggle the blocked status of a school
router.patch('/schools/:schoolId/block', adminController.toggleBlockSchool);

// Route for Super Admin to manage school subscriptions
router.put('/schools/:schoolId/subscription', adminController.updateSchoolSubscription);

// Route for Super Admin to get list of schools
router.get('/schools', adminController.getAllSchools);

// Route for Super Admin to get single school details
router.get('/schools/:id', adminController.getSchoolById);

// Route for Super Admin to update school details
router.put('/schools/:id', adminController.updateSchool);

// Route for Super Admin to delete school
router.delete('/schools/:id', adminController.deleteSchool);

// Route for Super Admin to get dashboard statistics
router.get('/stats', adminController.getAdminStats);

// Route for Super Admin to get revenue data
router.get('/revenue', adminController.getAdminStats);

// Route for Super Admin to record a manual revenue payment
router.post('/revenue/record', revenueController.recordPayment);

// Route for Super Admin to get revenue summary statistics
router.get('/revenue/summary', revenueController.getRevenueSummary);

// Route for Super Admin to get revenue list
router.get('/revenue/list', revenueController.getRevenueList);

// Route for Super Admin to get academic sessions
router.get('/sessions', adminController.getAllSessions);

// Route for Super Admin to get subscription plans
router.get('/plans', adminController.getPlans);

// Route for Super Admin to create subscription plan
router.post('/plans', adminController.createPlan);

// Route for Super Admin to update subscription plan
router.put('/plans/:id', adminController.updatePlan);

// Route for Super Admin to delete subscription plan
router.delete('/plans/:id', adminController.deletePlan);

// Route for Super Admin to assign subscription to school
router.post('/schools/:schoolId/subscription', adminController.assignSubscriptionToSchool);

// Route for Super Admin to get all school subscriptions
router.get('/school-subscriptions', adminController.getSchoolSubscriptions);

// Route for role-specific settings
router.get('/settings', adminController.getSettings);

// Route for Super Admin to update school settings
router.put('/schools/:id/settings', adminController.updateSchoolSettings);

// Route for Super Admin to reset proprietor password
router.post('/users/:id/reset-password', adminController.resetUserPassword);

module.exports = router;