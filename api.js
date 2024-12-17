import axios from 'axios';
import { ACCESS_TOKEN, ACCESS_TOKEN_COMMUNITY, API_VERSION } from './config.js';

export const apiCall = async (method, params = {}) => {
  params.access_token = method === 'messages.send' ? ACCESS_TOKEN_COMMUNITY : ACCESS_TOKEN
  params.v = API_VERSION;

  try {
    const response = await axios.get(`https://api.vk.com/method/${method}`, { params });
    if (response.data.error) {
      throw new Error(`VK API Error: ${response.data.error.error_msg}`);
    }
    return response.data.response;
  } catch (error) {
    console.error('Error making VK API call:', error);
    throw error;
  }
};

export const camisa7Call = async () => {
    try {
        const response = await axios.get('https://api.camisa7.botafogo.com.br/public/counter');
        return response.data.res;
    } catch (error) {
        console.error('Error making Camisa 7 API CALL:', error);
        throw error;
    }
    
};
