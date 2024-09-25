import { response } from 'express';
import { apiCall } from './api.js';
import { GROUP_ID } from './config.js';

// Function to post a reply to a discussion message
export const postReply = async (topicId, commentId, message) => {
  try {
    await apiCall('board.createComment', {
      group_id: GROUP_ID,
      topic_id: topicId,
      message: message,
      reply_to_comment: commentId
    });
    console.log('Reply posted successfully!');
  } catch (error) {
    console.error('Error posting reply:', error);
  }
};
