import { apiCall } from './api.js';

export const getUser = async (user_id) => {
    try {
      const response = await apiCall('users.get', { user_ids: user_id });
      return response[0].first_name;
    } catch (error) {
      console.error('Error getting discussions:', error);
    }
  };