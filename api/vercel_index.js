import { handleRequest } from "../src/core/request-handler.js";

export const config = {
  runtime: 'edge',
  regions: ['iad1'] 
};

export default async function handler(req) {
  return handleRequest(req);
}