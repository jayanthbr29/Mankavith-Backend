const mongoose = require("mongoose");
const Lecture = require("../model/lecturesModel");
const Course = require("../model/course_model");
const Subject = require("../model/subject_model");

// @desc    Create a new Lecture
// @route   POST /lecture
// @access  Private/Admin
exports.createLecture = async (req, res) => {
  try {
    const { lectureName, description, duration, videoUrl, subjectRef } = req.body;
    
    // Validate required fields
    // if (!lectureName || !duration || !videoUrl) {
    //   return res.status(400).json({ success: false, message: "lectureName, duration and videoUrl are required" });
    // }
    if (!lectureName) {
      return res.status(400).json({ success: false, message: "lectureName is required" });
    }

    // Optional: Validate courseRef and subjectRef
    // if (courseRef && !mongoose.Types.ObjectId.isValid(courseRef)) {
    //   return res.status(400).json({ success: false, message: "Invalid courseRef" });
    // }

    // if (subjectRef && !mongoose.Types.ObjectId.isValid(subjectRef)) {
    //   return res.status(400).json({ success: false, message: "Invalid subjectRef" });
    // }

    const lecture = new Lecture({ lectureName, description, duration, videoUrl, subjectRef });
    const savedLecture = await lecture.save();
    subjectRef.forEach(async (subjectId) => {
      const subject = await Subject.findById(subjectId);
      if (subject) {
        subject.lectures.push(savedLecture._id);
        await subject.save();
      }
    })

    res.status(201).json({ success: true, data: savedLecture });
  } catch (error) {
    console.error("Error creating lecture:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// @desc    Get all Lectures
// @route   GET /lecture
// @access  Public
exports.getAllLectures = async (req, res) => {
  try {
    const lectures = await Lecture.find()
      // .populate("courseRef", "courseName")
      // .populate("subjectRef", "subjectName")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: lectures.length, data: lectures });
  } catch (error) {
    console.error("Error fetching lectures:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// @desc    Get single Lecture by ID
// @route   GET /lecture/:id
// @access  Public
exports.getLectureById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lecture ID" });
    }

    const lecture = await Lecture.findById(id)
    // .populate("courseRef", "courseName")
    // .populate("subjectRef", "subjectName");

    if (!lecture) {
      return res.status(404).json({ success: false, message: "Lecture not found" });
    }

    res.status(200).json({ success: true, data: lecture });
  } catch (error) {
    console.error("Error fetching lecture:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// @desc    Update Lecture
// @route   PUT /lecture/:id
// @access  Private/Admin
exports.updateLecture = async (req, res) => {
  try {
    const { id } = req.params;
    const { lectureName, description, duration, videoUrl, subjectRef } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lecture ID" });
    }
    const lecture = await Lecture.findById(id);
    if (!lecture) {
      return res.status(404).json({ success: false, message: "Lecture not found" });
    }
    lecture.subjectRef.forEach(async (subjectId) => {
      const subject = await Subject.findById(subjectId);
      if (subject) {
        subject.lectures.pull(id);
        await subject.save();
      }
    })
    subjectRef.forEach(async (subjectId) => {
      const subject = await Subject.findById(subjectId);
      if (subject) {
        subject.lectures.push(id);
        await subject.save();
      }
    })

    const updatedLecture = await Lecture.findByIdAndUpdate(
      id,
      { lectureName, description, duration, videoUrl, subjectRef },
      { new: true, runValidators: true }
    )
    // .populate("courseRef", "courseName")
    // .populate("subjectRef", "subjectName");

    if (!updatedLecture) {
      return res.status(404).json({ success: false, message: "Lecture not found" });
    }

    res.status(200).json({ success: true, data: updatedLecture });
  } catch (error) {
    console.error("Error updating lecture:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// @desc    Delete Lecture
// @route   DELETE /lecture/:id
// @access  Private/Admin
exports.deleteLecture = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lecture ID" });
    }
    const lecture = await Lecture.findById(id);
    if (!lecture) {
      return res.status(404).json({ success: false, message: "Lecture not found" });
    }
    // Remove lecture from associated subjects
    await Promise.all(
      lecture.subjectRef.map(async (subjectId) => {
        const subject = await Subject.findById(subjectId);
        if (subject) {
          subject.lectures.pull(id);
          await subject.save();
        } else {
          return;
        }
      })
    );
    const deletedLecture = await Lecture.findByIdAndDelete(id);

    if (!deletedLecture) {
      return res.status(404).json({ success: false, message: "Lecture not found" });
    }

    res.status(200).json({ success: true, message: "Lecture deleted successfully" });
  } catch (error) {
    console.error("Error deleting lecture:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
exports.bulkDeleteLectures = async (req, res) => {
  try {
    const { lectureIds } = req.body;
    if (lectureIds.length === 0) {
      return res.status(400).json({ success: false, message: "No lecture IDs provided" });
    }

    let results = [];
    for (const id of lectureIds) {
      try {
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return res.status(400).json({ success: false, message: "Invalid lecture ID" });
        }
        const lecture = await Lecture.findById(id);
        if (!lecture) {
          results.push({ id, success: false, message: "Lecture not found" });
          continue; // Skip to the next ID if lecture not found
        }
        // Remove lecture from associated subjects
        await Promise.all(
          lecture.subjectRef.map(async (subjectId) => {
            const subject = await Subject.findById(subjectId);
            if (subject) {
              subject.lectures.pull(id);
              await subject.save();
            } else {
              return;
            }
          })
        );
        const deletedLecture = await Lecture.findByIdAndDelete(id);

        if (!deletedLecture) {
          results.push({ id, success: false, message: "Lecture not found" });
          continue; // Skip to the next ID if lecture not found
        }

        results.push({ id, success: true, message: "Lecture deleted successfully", data: deletedLecture });

      } catch (error) {
        console.error("Error processing lecture ID:", id, error);
        results.push({ id, success: false, message: "Error processing lecture", error: error.message });
      }
    }

    return res.status(200).json({ success: true, message: "Bulk delete operation completed", results });
  } catch (error) {
    console.error("Error deleting lecture:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
