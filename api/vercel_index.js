import { handleRequest } from "../src/core/request-handler.js";

export const config = {
  runtime: 'edge'
};

export default async function handler(req) {
  return handleRequest(req);
}