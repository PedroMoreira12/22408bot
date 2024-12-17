import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
export const API_VERSION = process.env.API_VERSION;
export const GROUP_ID = process.env.GROUP_ID;
export const ACCESS_TOKEN_COMMUNITY = process.env.ACCESS_TOKEN_COMMUNITY
