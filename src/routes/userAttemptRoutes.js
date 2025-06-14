const express = require('express');
const router = express.Router();
const attemptController = require('../controller/userAttemptController');


// User routes
router.post('/start',  attemptController.startAttempt);
router.put('/save',  attemptController.saveAnswer);
router.put('/submit', attemptController.submitAttempt);
router.get('/:id/:user_id', attemptController.getAttempt);
router.get('/get/user/:user_id/:mockTestId', attemptController.getUserAttempts);

// Admin routes
router.put('/evaluate', attemptController.evaluateSubjective);
router.get('/mocktest/:mockTestId/submitted-users', attemptController.getSubmittedUsersByMockTest);
router.get("/get/byId/:id", attemptController.getAttemptsById);
router.get("/get/submitedUser/byMockTest/:mockTestId", attemptController.getUsersSubmittedMockTest);

module.exports = router;