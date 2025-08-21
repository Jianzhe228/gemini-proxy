import { handleRequest } from "../src/core/request-handler.js";

export const config = {
  runtime: 'edge' //告诉 Vercel 这是 Edge Function
};

export default async function handler(req) {
  return handleRequest(req);
}