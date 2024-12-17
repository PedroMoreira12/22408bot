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

export const postMessage = async (topicId, commentId, userId, message, username) => {
  try {
    await apiCall('messages.send', {
      user_id: userId,
      random_id: 0,
      message: message
    });
    console.log('Message sent successfully!');
  } catch (error) {
      try {
        await apiCall('board.createComment', {
          group_id: GROUP_ID,
          topic_id: topicId,
          message: `[post${commentId}|${username}], Você tem que seguir a página https://vk.com/club228711116 e enviar uma mensagem para ela antes de usar esse comando. ✈️`,
          reply_to_comment: commentId
        });
        console.log('Reply posted successfully!');
      } catch (error) {
        console.error('Error posting reply:', error);
      }
    }
}
