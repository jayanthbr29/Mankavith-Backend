const UserAttempt = require('../model/userAttemptModel');
const MockTest = require('../model/mockTestModel');
const UserRanking = require('../model/userRankingModel');
const User = require('../model/user_model');
const mongoose = require('mongoose');
const { removeAllListeners } = require('../model/testimonialsModel');
const { sendMockTestSubmissionAlert } = require('../middleware/mailService');

// Start a new attempt (updated)getAttemptsByUserId
// exports.startAttempt = async (req, res) => {
//     try {
//         const { mockTestId, courseId, user_id } = req.body;

//         // Check attempt count for this course
//         const attemptCount = await UserAttempt.countDocuments({
//             userId: user_id,
//             mockTestId,
//             courseId
//         });

//         if (attemptCount >= 3) {
//             return res.status(200).json({
//                 success: false,
//                 message: 'Maximum attempts reached for this course'
//             });
//         }

//         const mockTest = await MockTest.findById(mockTestId);
//         if (!mockTest) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Test not found'
//             });
//         }

//         // Initialize answers array
//         const answers = mockTest.questions.map(question => ({
//             questionId: question._id,
//             answer: '',
//             isCorrect: false,
//             marksAwarded: 0
//         }));

//         const attempt = new UserAttempt({
//             userId: user_id,
//             mockTestId,
//             courseId, // Include course ID
//             attemptNumber: attemptCount + 1,
//             answers,
//             status: 'in-progress'
//         });

//         await attempt.save();

//         res.status(201).json({
//             success: true,
//             data: attempt
//         });
//     } catch (err) {
//         res.status(500).json({
//             success: false,
//             message: err.message
//         });
//     }
// };
exports.startAttempt = async (req, res) => {
    try {
        const { mockTestId, subject, user_id } = req.body;

        const attemptCount = await UserAttempt.countDocuments({
            userId: user_id,
            mockTestId,
            subject
        });



        const mockTest = await MockTest.findById(mockTestId);
        if (!mockTest) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }
        if (attemptCount >= mockTest.maxAttempts) {
            return res.status(200).json({
                success: false,
                message: 'Maximum attempts reached for this course'
            });
        }

        const now = new Date();
        const isWithinWindow = now >= new Date(mockTest.startDate) && now <= new Date(mockTest.endDate);

        // Initialize answers array
        const answers = mockTest.questions.map(question => ({
            questionId: question._id,
            answer: null,
            answerIndex: null, // For MCQ
            isCorrect: false,
            marksAwarded: 0
        }));

        const attempt = new UserAttempt({
            userId: user_id,
            mockTestId,
            subject,
            attemptNumber: attemptCount + 1,
            answers,
            status: 'in-progress',
            isWithinTestWindow: isWithinWindow // Set based on current time
        });

        await attempt.save();

        res.status(201).json({
            success: true,
            data: attempt,
            message: isWithinWindow ?
                'Attempt started (will count for rankings)' :
                'Attempt started (will NOT count for rankings)'
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Save an answer
exports.saveAnswer = async (req, res) => {
    try {
        const { attemptId, questionId, answer, user_id, userAnswerIndex, status } = req.body;

        const attempt = await UserAttempt.findOne({
            _id: attemptId,
            userId: user_id,
            status: 'in-progress'
        });

        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found or already submitted'
            });
        }

        const mockTest = await MockTest.findById(attempt.mockTestId);
        const question = mockTest.questions.id(questionId);

        if (!question) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        const validateStatus = ['answered', 'not-answered', 'not-answered-marked-for-review', 'answered-marked-for-review', 'unattempted'];
        const isValid = validateStatus.includes(status);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        // Find and update the answer
        const answerIndex = attempt.answers.findIndex(a =>
            a.questionId.equals(questionId)
        );

        if (answerIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Answer not found'
            });
        }
        if (status === 'unattempted' || status === 'not-answered-marked-for-review') {
            attempt.answers[answerIndex].status = status;
            await attempt.save();
            return res.status(200).json({
                success: true,
                data: attempt.answers[answerIndex]
            });
        }
        // For MCQ, check correctness immediately
        let isCorrect = false;
        if (question.type === 'mcq') {
            isCorrect = question.correctAnswer === userAnswerIndex;
        }

        attempt.answers[answerIndex] = {
            questionId,
            answer,
            answerIndex: question.type === 'mcq' ? userAnswerIndex : null,
            isCorrect,
            marksAwarded: question.type === 'mcq' ? (isCorrect ? question.marks : question.options[userAnswerIndex].marks) : 0,
            status

        };

        await attempt.save();

        res.status(200).json({
            success: true,
            data: attempt.answers[answerIndex]
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Submit attempt (updated)
exports.submitAttempt = async (req, res) => {
    try {
        const { attemptId, user_id } = req.body;

        const attempt = await UserAttempt.findOne({
            _id: attemptId,
            userId: user_id,
            status: 'in-progress'
        }).populate('mockTestId');

        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found or already submitted'
            });
        }

        const now = new Date();
        const isWithinWindow = attempt.isWithinTestWindow;
        const attemptNumber = attempt.attemptNumber;

        const mockTest = await MockTest.findById(attempt.mockTestId);

        // Calculate MCQ score
        let mcqScore = 0;
        attempt.answers = attempt.answers.map(answer => {
            const question = mockTest.questions.id(answer.questionId);

            if (question.type === 'mcq') {
                if (answer.status === 'unattempted' || answer.status === 'not-answered-marked-for-review') {

                    const marks = 0;
                    mcqScore += marks;

                    return {
                        ...answer.toObject(),
                        isCorrect: false,
                        marksAwarded: marks
                    };
                } else {
                    const isCorrect = question.correctAnswer === answer.answerIndex;
                    const marks = isCorrect ? question.marks : question.options[answer.answerIndex].marks;
                    mcqScore += marks;

                    return {
                        ...answer.toObject(),
                        isCorrect,
                        marksAwarded: marks
                    };
                }

            }
            return answer;
        });

        attempt.mcqScore = mcqScore;
        attempt.submittedAt = new Date();

        // Check if test has subjective questions
        const hasSubjective = mockTest.questions.some(q => q.type === 'subjective');

        if (hasSubjective) {
            attempt.status = 'submitted';
            attempt.totalMarks = mcqScore;
        } else {
            attempt.status = 'evaluated';
            attempt.evaluatedAt = new Date();
            attempt.totalMarks = mcqScore;
        }

        await attempt.save();

        // If no subjective questions, update rankings immediately
        if (isWithinWindow) {
            if (!hasSubjective) {
                await updateRankings(attempt);
            }
        }
        const questionIds = [];

        attempt.answers.forEach(answer => {
            questionIds.push(answer.questionId);
        });

        const answeredQuestions = await MockTest.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(attempt.mockTestId) } },
            { $unwind: '$questions' },
            { $match: { 'questions._id': { $in: questionIds } } },
            { $project: { question: '$questions' } }
        ]);
        const questionMap = {};
        answeredQuestions.forEach(item => {
            questionMap[item.question._id.toString()] = item.question;
        });
        const enhancedAttempts = {
            ...attempt.toObject(),
            answers: attempt.answers.map(answer => ({
                ...answer.toObject(),
                questionDetails: questionMap[answer.questionId.toString()]
            }))
        };
        const user = await User.findById(user_id);
        const userAdmin = await User.find({ role: 'admin' });
        await userAdmin.map(async admin => {
            sendMockTestSubmissionAlert(user.displayName, user.email, attempt.mockTestId.title, attempt.mcqScore, attempt.totalMarks, admin.email);
        })

        res.status(200).json({
            success: true,
            // data: attempt,
            data: enhancedAttempts,
            message: isWithinWindow ?
                'Attempt submitted (counts for rankings)' :
                'Attempt submitted (does NOT count for rankings)'
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Admin: Evaluate subjective answers
exports.evaluateSubjective = async (req, res) => {
    try {
        const { attemptId, evaluations } = req.body;

        const attempt = await UserAttempt.findById(attemptId).populate('mockTestId');
        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found'
            });
        }
        console.log(attempt.status);

        if (attempt.status !== 'submitted'&& attempt.status !== 'evaluating') {
            return res.status(400).json({
                success: false,
                message: 'Attempt is not ready for evaluation'
            });
        }
       console.log(attempt.status);
        const mockTest = await MockTest.findById(attempt.mockTestId._id);
        const now = new Date();
        const isWithinWindow = attempt.isWithinTestWindow;
        const attemptNumber = attempt.attemptNumber;

        let subjectiveScore = 0;

        // Process each evaluation
        attempt.answers = attempt.answers.map(answer => {
            const question = mockTest.questions.id(answer.questionId);

            if (question.type === 'subjective') {
                const evaluation = evaluations.find(e => {
                    return answer.questionId.equals(e.questionId)
                }
                );

                if (evaluation) {
                    subjectiveScore += evaluation.marks;
                    return {
                        ...answer.toObject(),
                        marksAwarded: evaluation.marks,
                        isCorrect: evaluation.isCorrect
                    };
                }
            }
            return answer;
        });

        attempt.subjectiveScore = subjectiveScore;
        attempt.totalMarks = attempt.mcqScore + subjectiveScore;
        attempt.status = 'evaluated';
        attempt.evaluatedAt = new Date();


        await attempt.save();
        if (isWithinWindow) {
            await updateRankings(attempt);

        }

        res.status(200).json({
            success: true,
            data: attempt
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Get attempt details
exports.getAttempt = async (req, res) => {
    try {
        const { user_id, id } = req.params;
        if (!user_id, !id) {
            return res.status(400).json({ success: false, message: "Missing user_id and attempt_id" });
        }
        let attempt = await UserAttempt.findOne({
            _id: req.params.id,
            userId: req.params.user_id
        }).populate('mockTestId');
        const attemptObj = attempt.toObject();

        attemptObj.answers = attemptObj.answers.map(answer => {

            const isSubmitted = answer.questionId.type === 'mcq'
                ? answer.answerIndex !== null && answer.answerIndex !== undefined
                : answer.answer !== null && answer.answer !== '' && answer.answer !== undefined;

            return {
                ...answer,
                answerSubmitted: isSubmitted
            };
        });

        attempt = attemptObj;
        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found'
            });
        }


        res.status(200).json({
            success: true,
            data: attempt
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Get all attempts for a user and test
exports.getUserAttempts = async (req, res) => {
    try {
        if (!req.params.user_id || !req.params.mockTestId) {
            return res.status(400).json({ success: false, message: "Missing user_id and mockTestId" });
        }
        const attempts = await UserAttempt.find({
            userId: req.params.user_id,
            mockTestId: req.params.mockTestId
        }).sort({ attemptNumber: 1 })
            .populate([
                {
                    path: 'mockTestId',
                    model: 'MockTest'
                },
                {
                    path: 'subject',
                    model: 'Subject'
                }
            ]);

        const questionIds = [];
        attempts.forEach(attempt => {
            attempt.answers.forEach(answer => {
                questionIds.push(answer.questionId);
            });
        });
        const answeredQuestions = await MockTest.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(req.params.mockTestId) } },
            { $unwind: '$questions' },
            { $match: { 'questions._id': { $in: questionIds } } },
            { $project: { question: '$questions' } }
        ]);
        const questionMap = {};
        answeredQuestions.forEach(item => {
            questionMap[item.question._id.toString()] = item.question;
        });
        const enhancedAttempts = attempts.map(attempt => {
            return {
                ...attempt.toObject(),
                answers: attempt.answers.map(answer => ({
                    ...answer.toObject(),
                    questionDetails: questionMap[answer.questionId.toString()]
                }))
            };
        });

        res.status(200).json({
            success: true,
            // data: attempts,
            data: enhancedAttempts
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Helper function to update rankings (updated)
async function updateRankings(attempt) {
    // Get all evaluated attempts for this user, test, and course
    const attempts = await UserAttempt.find({
        userId: attempt.userId,
        mockTestId: attempt.mockTestId,
        courseId: attempt.courseId,
        status: 'evaluated',
        isWithinTestWindow: true
    });

    // Find best attempt (highest score, earliest submission for ties)
    let bestAttempt = attempts.reduce((best, current) => {
        if (current.totalMarks > best.totalMarks) return current;
        if (current.totalMarks === best.totalMarks &&
            current.submittedAt < best.submittedAt) return current;
        return best;
    }, attempts[0]);

    // Update all attempts to mark which is best
    await UserAttempt.updateMany(
        {
            userId: attempt.userId,
            mockTestId: attempt.mockTestId,
            courseId: attempt.courseId
        },
        { $set: { isBestAttempt: false } }
    );
    if (bestAttempt) {

        bestAttempt.isBestAttempt = true;
        await bestAttempt.save();


        // Update or create ranking
        const ranking = await UserRanking.findOneAndUpdate(
            {
                userId: attempt.userId,
                mockTestId: attempt.mockTestId,
                subject: attempt.subject
            },
            {
                bestAttemptId: bestAttempt._id,
                bestScore: bestAttempt.totalMarks,
                attemptsCount: attempts.length,
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        );
    }

    // Recalculate all rankings for this test and course
    await recalculateTestRankings(attempt.mockTestId, attempt.subject);
}

async function recalculateTestRankings(mockTestId, subject) {
    const rankings = await UserRanking.find({
        mockTestId,
        subject
    }).sort({ bestScore: -1, lastUpdated: 1 });

    let currentRank = 1;
    for (let i = 0; i < rankings.length; i++) {
        // Same rank for same scores
        if (i > 0 && rankings[i].bestScore === rankings[i - 1].bestScore) {
            rankings[i].rank = rankings[i - 1].rank;
        } else {
            rankings[i].rank = currentRank;
        }
        currentRank++;

        await rankings[i].save();
    }
}

async function recalculateTestRankings(mockTestId) {
    const rankings = await UserRanking.find({ mockTestId })
        .sort({ bestScore: -1, lastUpdated: 1 });

    let currentRank = 1;
    for (let i = 0; i < rankings.length; i++) {
        // Same rank for same scores
        if (i > 0 && rankings[i].bestScore === rankings[i - 1].bestScore) {
            rankings[i].rank = rankings[i - 1].rank;
        } else {
            rankings[i].rank = currentRank;
        }
        currentRank++;

        await rankings[i].save();
    }
}

exports.getSubmittedUsersByMockTest = async (req, res) => {
    try {
        const { mockTestId } = req.params;
        const { status } = req.query;
        let query = { mockTestId };
        if (status) {
            query.status = status; // Filter by status if provided
        }

        // First, get all submitted attempts for this mock test
        let attempts = await UserAttempt.find(query)
            .populate('userId')
            .populate({
                path: 'mockTestId',
                select: 'questions' // get the questions from mock test
            });

        attempts = attempts.map(attempt => {
            const questions = attempt.mockTestId.questions;
            const answersWithQuestions = attempt.answers.map(answer => {
                const question = questions.find(q => q._id.equals(answer.questionId));
                return {
                    ...answer.toObject(),
                    questionDetails: question
                };
            });
            return {
                ...attempt.toObject(),
                answers: answersWithQuestions
            };
        });

        if (!attempts || attempts.length === 0) {
            return res.status(404).json({ message: 'No submitted attempts found for this mock test' });
        }

        // Group attempts by user
        const usersMap = new Map();

        attempts.forEach(attempt => {
            const userId = attempt.userId._id.toString();

            if (!usersMap.has(userId)) {
                usersMap.set(userId, {
                    user: attempt.userId,
                    attempts: [],
                    bestAttempt: null,
                    highestScore: 0
                });
            }

            const userData = usersMap.get(userId);
            userData.attempts.push(attempt);

            // Track best attempt (highest score)
            if (attempt.totalMarks > userData.highestScore) {
                userData.highestScore = attempt.totalMarks;
                userData.bestAttempt = attempt;
            }
        });

        // Convert map to array of user objects
        const users = Array.from(usersMap.values());

        res.status(200).json({
            success: true,
            count: users.length,
            data: users
        });

    } catch (error) {
        console.error('Error fetching submitted users:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching submitted users',
            error: error.message
        });
    }
};

exports.getAttemptsById = async (req, res) => {
    try {
        const { id } = req.params;



        const attempts = await UserAttempt.findById(id)
            .populate('mockTestId subject userId')
            ;

        if (!attempts) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found'
            });
        }
        const questionIds = [];

        attempts.answers.forEach(answer => {
            questionIds.push(answer.questionId);
        });
        ;
        const answeredQuestions = await MockTest.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(attempts.mockTestId) } },
            { $unwind: '$questions' },
            { $match: { 'questions._id': { $in: questionIds } } },
            { $project: { question: '$questions' } }
        ]);
        const questionMap = {};
        answeredQuestions.forEach(item => {
            questionMap[item.question._id.toString()] = item.question;
        });
        const enhancedAttempts = {
            ...attempts.toObject(),
            answers: attempts.answers.map(answer => ({
                ...answer.toObject(),
                questionDetails: questionMap[answer.questionId.toString()]
            }))
        };


        res.status(200).json({
            success: true,
            data: enhancedAttempts
        });
    } catch (error) {
        console.error('Error fetching attempts:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching attempts',
            error: error.message
        });
    }
};
exports.getUsersSubmittedMockTest = async (req, res) => {
    try {
        const { mockTestId } = req.params;

        // Find all submitted attempts for this mock test
        const submittedAttempts = await UserAttempt.find({
            mockTestId: mockTestId,
            status: { $in: ['submitted', 'evaluated', 'evaluating'] }
        }).populate('userId'); // Adjust fields as per your User model

        if (!submittedAttempts.length) {
            return res.status(200).json({
                success: false,
                message: 'No submitted attempts found for this mock test',
                count: 0,
                data: []
            });
        }

        // Extract unique users from the attempts
        const usersMap = new Map();
        submittedAttempts.forEach(attempt => {
            if (attempt.userId && !usersMap.has(attempt.userId._id.toString())) {
                usersMap.set(attempt.userId._id.toString(), attempt.userId);
            }
        });

        const users = Array.from(usersMap.values());

        res.status(200).json({
            success: true,
            count: users.length,
            data: users
        });

    } catch (error) {
        console.error('Error fetching submitted users:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

exports.evaluateSingleQuestion = async (req, res) => {
    try {
        const { attemptId, questionId, marks, isCorrect } = req.body;


        const attempt = await UserAttempt.findById(attemptId);
        if (!attempt) {
            return res.status(404).json({ success: false, message: 'Attempt not found' });
        }
        if (attempt.status === 'evaluated') {
            return res.status(400).json({ success: false, message: 'Attempt already evaluated' });
        }

        if (attempt.status !== 'submitted' && attempt.status !== 'evaluating') {
            return res.status(400).json({ success: false, message: 'Attempt is not ready for evaluation' });
        }

        const mockTest = await MockTest.findById(attempt.mockTestId);
        if (!mockTest) {
            return res.status(404).json({ success: false, message: 'MockTest not found' });
        }

        const question = mockTest.questions.id(questionId);
        if (!question || question.type !== 'subjective') {
            return res.status(400).json({ success: false, message: 'Invalid subjective question' });
        }

        let subjectiveScore = 0;
        let found = false;

        attempt.answers = attempt.answers.map(answer => {
            if (answer.questionId.toString() === questionId) {
                found = true;
                return {
                    ...answer.toObject(),
                    marksAwarded: marks,
                    isCorrect: isCorrect,

                };
            }
            return answer;
        });

        if (!found) {
            return res.status(404).json({ success: false, message: 'Answer not found in attempt' });
        }


        subjectiveScore = attempt.answers.reduce((acc, answer) => {
            if (answer.marksAwarded && mockTest.questions.id(answer.questionId).type === 'subjective') {
                return acc + answer.marksAwarded;
            }
            return acc;
        }, 0);

        attempt.subjectiveScore = subjectiveScore;
        attempt.totalMarks = attempt.mcqScore + subjectiveScore;

        // Check if all subjective questions are evaluated
        // const totalSubjective = mockTest.questions.filter(q => q.type === 'subjective').length;
        // const evaluatedCount = attempt.answers.filter(a => {
        //     const q = mockTest.questions.id(a.questionId);
        //     return q && q.type === 'subjective' && a.marksAwarded !== undefined;
        // }).length;

        // if (evaluatedCount > 0) {
        //     attempt.status = evaluatedCount === totalSubjective ? 'evaluated' : 'evaluating';
        // }
        attempt.status = 'evaluating';
        await attempt.save();

        return res.status(200).json({
            success: true,
            message: 'Question evaluated',
            data: attempt
        });
    } catch (error) {
        console.error("Evaluate single question error:", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.completeUserAttemptsEvaluation = async (req, res) => {
    try {
        const { attemptId } = req.body;

        const attempt = await UserAttempt.findById(attemptId).populate('mockTestId');
        if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });

        const mockTest = await MockTest.findById(attempt.mockTestId);
        const totalSubjective = mockTest.questions.filter(q => q.type === 'subjective').length;
        const evaluatedCount = attempt.answers.filter(a => {
            const q = mockTest.questions.id(a.questionId);
            return q?.type === 'subjective' && typeof a.marksAwarded === 'number';
        }).length;

        if (evaluatedCount < totalSubjective) {
            return res.status(400).json({ success: false, message: 'Evaluation not complete' });
        }

        attempt.status = 'evaluated';
        attempt.evaluatedAt = new Date();
        await attempt.save();

        if (attempt.isWithinTestWindow) {
            await updateRankings(attempt);
        }

        res.status(200).json({ success: true, message: 'Evaluation marked as complete', data: attempt });

    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};

exports.getUserAttemptsBySubject = async (req, res) => {
    try {
        const { user_id, subject } = req.body;
        const attempts = await UserAttempt.find({ userId: user_id, subject: subject, $or: [{ status: 'submitted' }, { status: 'evaluated' }, { status: 'evaluating' }] }).populate('mockTestId');
        res.status(200).json({ success: true, data: attempts });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};
exports.getAttemptsByUserId = async (req, res) => {
    try {
        const { user_id } = req.params;
        const attempts = await UserAttempt.find({ userId: user_id, $or: [{ status: 'submitted' }, { status: 'evaluated' }, { status: 'evaluating' }] })
            .populate({
                path: 'mockTestId',
                populate: {
                    path: 'subject',
                }
            })
            .populate('userId')
            .populate('subject');
        res.status(200).json({ success: true, data: attempts });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};
exports.getAllAttempts = async (req, res) => {
    try {
        const attempts = await UserAttempt.find({ $or: [{ status: 'submitted' }, { status: 'evaluated' }, { status: 'evaluating' }] })
            .populate({
                path: 'mockTestId',
                populate: {
                    path: 'subject',
                }
            })
            .populate('subject')
            .populate('userId');
        res.status(200).json({ success: true, data: attempts });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};

exports.deleteUserAttempt = async (req, res) => {
    try {
        const { attemptId } = req.body;
        const attempt = await UserAttempt.findByIdAndDelete(attemptId);
        const userRanking = await UserRanking.findOneAndDelete({ userId: attempt.userId, subject: attempt.subject, bestAttemptId: attempt._id });
        const userAttempts = await UserAttempt.find({ userId: attempt.userId, attemptNumber: { $gt: attempt.attemptNumber }, subject: attempt.subject, });
        for (let i = 0; i < userAttempts.length; i++) {
            userAttempts[i].attemptNumber -= 1;
            await userAttempts[i].save();
        }

        if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
        const result = await updateRankings(attempt);
        res.status(200).json({ success: true, message: 'Attempt deleted successfully', data: attempt });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};


exports.getUserResults = async (req, res) => {
    try {
        const { user_id, mockTestId } = req.body;
        const attempts = await UserAttempt.find({ userId: user_id, mockTestId, $or: [{ status: 'submitted' }, { status: 'evaluated' }, { status: 'evaluating' }] }).populate('mockTestId');
        const mockTest = await MockTest.findById(mockTestId);
        const totalAttempts = mockTest.maxAttempts;
        const userAttempts = attempts.length;
        const remainigAttempts = totalAttempts - userAttempts;
        const attempt = attempts.find((attempt, index) => index === attempts.length - 1);
        const ranking = await UserRanking.findOne({ userId: user_id, mockTestId, subject: mockTest.subject }).populate('subject');
        if (!attempt) {
            res.status(200).json({ success: true, totalAttempts, remainigAttempts, result: {} });
        } else {


            const questionIds = [];

            attempt.answers.forEach(answer => {
                questionIds.push(answer.questionId);
            });

            const answeredQuestions = await MockTest.aggregate([
                { $match: { _id: new mongoose.Types.ObjectId(attempt.mockTestId) } },
                { $unwind: '$questions' },
                { $match: { 'questions._id': { $in: questionIds } } },
                { $project: { question: '$questions' } }
            ]);
            const questionMap = {};
            answeredQuestions.forEach(item => {
                questionMap[item.question._id.toString()] = item.question;
            });
            const enhancedAttempts = {
                ...attempt.toObject(),
                answers: attempt.answers.map(answer => ({
                    ...answer.toObject(),
                    questionDetails: questionMap[answer.questionId.toString()]
                }))
            };
            res.status(200).json({ success: true, totalAttempts, remainigAttempts, result: enhancedAttempts, ranking });
        }
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};