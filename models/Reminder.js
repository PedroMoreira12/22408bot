// models/Reminder.js
import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema({
  topicId: {
    type: String,
    required: true,
  },
  messageId: {
    type: String,
    required: true,
  },
  userId: {
    type: String,
    required: true,
  },
  remindAt: {
    type: Date,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
});

const Reminder = mongoose.model('Reminder', reminderSchema);

export default Reminder;
