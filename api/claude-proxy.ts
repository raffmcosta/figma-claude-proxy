import { VercelRequest, VercelResponse } from "@vercel/node";
import axios, { AxiosError } from "axios";

// Simple in-memory rate limiter (note: resets on cold starts)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Check if client has exceeded rate limit
 */
function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const limit = parseInt(process.env.RATE_LIMIT_REQUESTS || "100");
  const window = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000");

  const current = rateLimitStore.get(clientId);

  if (!current || current.resetTime < now) {
    rateLimitStore.set(clientId, { count: 1, resetTime: now + window });
    return true;
  }

  if (current.count < limit) {
    current.count++;
    return true;
  }

  return false;
}

/**
 * Validate Claude API request format
 */
function validateClaudeRequest(body: any): { valid: boolean; error?: string } {
  // Check required fields
  if (!body.messages || !Array.isArray(body.messages)) {
    return { valid: false, error: "Missing or invalid 'messages' array" };
  }

  if (body.messages.length === 0) {
    return { valid: false, error: "Messages array cannot be empty" };
  }

  // Check message format
  for (const msg of body.messages) {
    if (!msg.role || !msg.content) {
      return { valid: false, error: "Each message must have 'role' and 'content'" };
    }
    if (!["user", "assistant"].includes(msg.role)) {
      return { valid: false, error: "Message role must be 'user' or 'assistant'" };
    }
  }

  // Validate model (whitelist allowed models)
  const allowedModels = [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-20240620",
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
  ];

  if (!body.model) {
    return { valid: false, error: "Missing 'model' field" };
  }

  if (!allowedModels.includes(body.model)) {
    return {
      valid: false,
      error: `Invalid model. Allowed models: ${allowedModels.join(", ")}`
    };
  }

  // Check max_tokens is reasonable (Claude's max is 4096)
  if (body.max_tokens && (body.max_tokens < 1 || body.max_tokens > 4096)) {
    return { valid: false, error: "max_tokens must be between 1 and 4096" };
  }

  return { valid: true };
}

/**
 * Handle errors from Claude API
 */
function handleProxyError(error: any, res: VercelResponse) {
  // Handle Claude API errors
  if (axios.isAxiosError(error) && error.response) {
    const status = error.response.status;
    const data = error.response.data;

    console.error(`Claude API error ${status}:`, data);

    // Handle rate limiting with retry-after
    if (status === 429) {
      const retryAfter = error.response.headers["retry-after"] || "60";
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message: data.error?.message || "Claude API rate limit reached",
        retry_after: retryAfter,
      });
    }

    // Handle authentication errors
    if (status === 401 || status === 403) {
      return res.status(status).json({
        error: "authentication_failed",
        message: "Invalid or expired API credentials",
      });
    }

    // Handle overload (529 is Claude's overload status)
    if (status === 529) {
      res.setHeader("Retry-After", "60");
      return res.status(503).json({
        error: "service_unavailable",
        message: "Claude API is experiencing high traffic",
      });
    }

    // Handle validation errors
    if (status === 400) {
      return res.status(400).json({
        error: "invalid_request",
        message: data.error?.message || "Invalid request to Claude API",
      });
    }

    // Handle all other API errors
    return res.status(status).json({
      error: data.error?.type || "api_error",
      message: data.error?.message || "Unknown error from Claude API",
    });
  }

  // Handle network/timeout errors
  if (axios.isAxiosError(error)) {
    if (error.code === "ECONNABORTED") {
      return res.status(504).json({
        error: "request_timeout",
        message: "Claude API request timed out after 30 seconds",
      });
    }

    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      return res.status(503).json({
        error: "service_unavailable",
        message: "Could not connect to Claude API",
      });
    }
  }

  // Handle other errors
  console.error("Unexpected proxy error:", error);
  return res.status(500).json({
    error: "internal_server_error",
    message: "An unexpected error occurred while proxying your request",
  });
}

/**
 * Main proxy handler for Claude API requests
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Set CORS headers for all responses
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    // Validate request method
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "method_not_allowed",
        message: "Only POST requests are supported",
      });
    }

    // Get client identifier (IP address)
    const clientId =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    // Check rate limit
    if (!checkRateLimit(clientId)) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message: "Too many requests. Please try again later.",
      });
    }

    // Validate request body
    const validation = validateClaudeRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: "invalid_request",
        message: validation.error,
      });
    }

    // Extract API key from environment
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return res.status(500).json({
        error: "server_configuration_error",
        message: "API key not configured on server",
      });
    }

    // Forward request to Claude API
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      req.body,
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 30000, // 30 second timeout
      }
    );

    // Forward Claude's rate limit headers to client
    if (response.headers["anthropic-ratelimit-requests-remaining"]) {
      res.setHeader(
        "X-RateLimit-Remaining",
        response.headers["anthropic-ratelimit-requests-remaining"]
      );
    }
    if (response.headers["anthropic-ratelimit-requests-reset"]) {
      res.setHeader(
        "X-RateLimit-Reset",
        response.headers["anthropic-ratelimit-requests-reset"]
      );
    }

    // Return Claude's response to client
    return res.status(200).json(response.data);
  } catch (error: any) {
    return handleProxyError(error, res);
  }
}
