import { VercelRequest, VercelResponse } from "@vercel/node";
import axios, { AxiosError } from "axios";

// Simple in-memory rate limiter (note: resets on cold starts)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Logger utility for consistent logging format
 */
function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;

  if (level === 'ERROR') {
    console.error(logMessage, data ? JSON.stringify(data, null, 2) : '');
  } else if (level === 'WARN') {
    console.warn(logMessage, data ? JSON.stringify(data, null, 2) : '');
  } else {
    console.log(logMessage, data ? JSON.stringify(data, null, 2) : '');
  }
}

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
    // Latest Claude 4.x models (2025)
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-1-20250805",
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    // Legacy Claude 3.x models
    "claude-3-7-sonnet-20250219",
    "claude-3-5-haiku-20241022",
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

  // Check max_tokens is reasonable (Claude supports up to 8192 for vision)
  if (body.max_tokens && (body.max_tokens < 1 || body.max_tokens > 8192)) {
    return { valid: false, error: "max_tokens must be between 1 and 8192" };
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

    log('ERROR', `Claude API error ${status}`, {
      status,
      errorType: data.error?.type,
      errorMessage: data.error?.message,
      headers: error.response.headers
    });

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
        message: "Claude API request timed out after 60 seconds",
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
  log('ERROR', 'Unexpected proxy error', {
    error: error.message,
    stack: error.stack,
    name: error.name
  });
  return res.status(500).json({
    error: "internal_server_error",
    message: "An unexpected error occurred while proxying your request",
  });
}

/**
 * Main proxy handler for Claude API requests
 * Updated: 2025-11-03 - Added Claude 4.x model support
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
    // Log incoming request
    const clientId =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    log('INFO', 'Incoming proxy request', {
      clientId,
      method: req.method,
      model: req.body?.model,
      maxTokens: req.body?.max_tokens,
      messageCount: req.body?.messages?.length
    });

    // Validate request method
    if (req.method !== "POST") {
      log('WARN', 'Invalid method', { method: req.method, clientId });
      return res.status(405).json({
        error: "method_not_allowed",
        message: "Only POST requests are supported",
      });
    }

    // Check rate limit
    if (!checkRateLimit(clientId)) {
      log('WARN', 'Rate limit exceeded', { clientId });
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message: "Too many requests. Please try again later.",
      });
    }

    // Validate request body
    const validation = validateClaudeRequest(req.body);
    if (!validation.valid) {
      log('WARN', 'Invalid request body', {
        clientId,
        error: validation.error,
        body: req.body
      });
      return res.status(400).json({
        error: "invalid_request",
        message: validation.error,
      });
    }

    // Extract API key from environment
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      log('ERROR', 'ANTHROPIC_API_KEY not configured');
      return res.status(500).json({
        error: "server_configuration_error",
        message: "API key not configured on server",
      });
    }

    // Forward request to Claude API
    log('INFO', 'Forwarding request to Claude API', {
      clientId,
      model: req.body.model,
      maxTokens: req.body.max_tokens
    });

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      req.body,
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 60000, // 60 second timeout for vision analysis
        maxBodyLength: 50 * 1024 * 1024, // 50MB max body size for images
        maxContentLength: 50 * 1024 * 1024, // 50MB max content size
      }
    );

    // Log successful response
    log('INFO', 'Claude API response received', {
      clientId,
      status: response.status,
      model: response.data.model,
      stopReason: response.data.stop_reason,
      inputTokens: response.data.usage?.input_tokens,
      outputTokens: response.data.usage?.output_tokens,
      rateLimitRemaining: response.headers["anthropic-ratelimit-requests-remaining"]
    });

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
