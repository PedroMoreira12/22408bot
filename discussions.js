import { apiCall } from './api.js';
import { GROUP_ID } from './config.js';

export const getAllDiscussions = async () => {
  try {
    const response = await apiCall('board.getTopics', { group_id: GROUP_ID, count: 100 });
    return response.items;
  } catch (error) {
    console.error('Error getting discussions:', error);
  }
};

// Get messages from a specific discussion
export const getDiscussionMessages = async (topicId) => {
  try {
    const response = await apiCall('board.getComments', {
      group_id: GROUP_ID,
      topic_id: topicId,
      sort: 'desc',
      count: 10
    });
    return response.items;
  } catch (error) {
    console.error(`Error getting messages for topic ${topicId}:`, error);
  }
};
