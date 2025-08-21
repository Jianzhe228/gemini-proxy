import { handleRequest } from "./core/request-handler.js";

export default {
  async fetch(req) {
    return handleRequest(req);
  }
}