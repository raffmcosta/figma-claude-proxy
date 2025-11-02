# Figma Claude Proxy

A secure Vercel-based proxy server that enables Figma plugins to communicate with Anthropic's Claude API. This proxy handles CORS restrictions, manages API keys securely, and provides rate limiting.

## Why This Proxy?

Figma plugins run in a sandboxed environment and cannot directly make requests to external APIs. This proxy server:

- Handles CORS (Cross-Origin Resource Sharing) requirements for Figma plugins
- Keeps your Claude API key secure (never exposed in client-side code)
- Provides rate limiting to prevent abuse
- Validates requests before forwarding to Claude API
- Handles errors gracefully with proper HTTP status codes

## Features

- **Secure API Key Management**: API keys stored as Vercel environment variables
- **CORS Support**: Properly configured for Figma plugin requests
- **Rate Limiting**: Basic IP-based rate limiting (100 requests/minute by default)
- **Request Validation**: Validates all requests before forwarding to Claude
- **Error Handling**: Comprehensive error handling for all Claude API error codes
- **TypeScript**: Fully typed for better developer experience
- **Zero Config Deployment**: Deploy to Vercel with a single command

## Prerequisites

Before you begin, you'll need:

1. **Claude API Key**: Get one from [Anthropic Console](https://console.anthropic.com/settings/keys)
2. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
3. **Node.js**: Version 18 or higher
4. **Git**: For version control

## Quick Start

### 1. Clone or Download This Repository

```bash
git clone <your-repo-url>
cd figma-claude-proxy
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

For local development, create a `.env.local` file:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your Claude API key:

```env
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-api-key-here
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
```

### 4. Test Locally (Optional)

```bash
npm run dev
```

This starts a local development server at `http://localhost:3000`. You can test the proxy:

```bash
curl -X POST http://localhost:3000/api/claude-proxy \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello, Claude!"}
    ]
  }'
```

### 5. Deploy to Vercel

#### Option A: Deploy via Vercel CLI

```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to production
npm run deploy
```

#### Option B: Deploy via Vercel Dashboard

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your Git repository
3. Vercel will auto-detect the configuration
4. Click "Deploy"

### 6. Configure Production Environment Variables

After deployment, add your API key in Vercel Dashboard:

1. Go to your project in Vercel Dashboard
2. Navigate to **Settings** > **Environment Variables**
3. Add the following variables:
   - `ANTHROPIC_API_KEY`: Your Claude API key (mark as **Sensitive**)
   - `RATE_LIMIT_REQUESTS`: `100` (optional)
   - `RATE_LIMIT_WINDOW_MS`: `60000` (optional)
4. Redeploy your project for changes to take effect

### 7. Get Your Proxy URL

After deployment, Vercel will provide you with a URL like:

```
https://your-project-name.vercel.app
```

Your proxy endpoint will be:

```
https://your-project-name.vercel.app/api/claude-proxy
```

## Using the Proxy in Your Figma Plugin

### Example Figma Plugin Code

```typescript
// In your Figma plugin (ui.html or code.ts)

async function askClaude(userMessage: string) {
  const PROXY_URL = "https://your-project-name.vercel.app/api/claude-proxy";

  try {
    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: userMessage
          }
        ]
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Extract Claude's response
    const claudeMessage = data.content[0].text;
    console.log("Claude says:", claudeMessage);

    return claudeMessage;
  } catch (error) {
    console.error("Error calling Claude API:", error);
    throw error;
  }
}

// Usage
askClaude("Explain what Figma plugins can do in 2 sentences")
  .then(response => {
    // Display response in your Figma plugin UI
    console.log(response);
  })
  .catch(error => {
    // Handle error in your UI
    console.error("Failed to get response:", error);
  });
```

### Handling Rate Limits

```typescript
async function askClaudeWithRetry(userMessage: string, maxRetries = 3) {
  const PROXY_URL = "https://your-project-name.vercel.app/api/claude-proxy";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1024,
          messages: [{ role: "user", content: userMessage }]
        }),
      });

      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = parseInt(response.headers.get("Retry-After") || "60");
        console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.content[0].text;

    } catch (error) {
      if (attempt === maxRetries - 1) throw error;

      // Exponential backoff for other errors
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

## API Reference

### Endpoint

```
POST /api/claude-proxy
```

### Request Body

The proxy accepts the same request format as [Claude's Messages API](https://docs.anthropic.com/claude/reference/messages_post):

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "Hello, Claude!"
    }
  ]
}
```

### Supported Models

- `claude-3-5-sonnet-20241022` (Recommended)
- `claude-3-5-sonnet-20240620`
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`

### Response

Success (200):

```json
{
  "id": "msg_01XYZ...",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you today?"
    }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 20
  }
}
```

### Error Responses

Rate Limit Exceeded (429):

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please try again later.",
  "retry_after": "60"
}
```

Invalid Request (400):

```json
{
  "error": "invalid_request",
  "message": "Missing or invalid 'messages' array"
}
```

Server Error (500):

```json
{
  "error": "internal_server_error",
  "message": "An unexpected error occurred while proxying your request"
}
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | Your Claude API key from Anthropic Console |
| `RATE_LIMIT_REQUESTS` | No | `100` | Maximum requests per time window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Time window in milliseconds (1 minute) |

### Rate Limiting

The proxy includes basic IP-based rate limiting:

- **Default**: 100 requests per minute per IP address
- **Configurable**: Set via environment variables
- **Note**: This is a simple in-memory implementation that resets on cold starts. For production, consider using Vercel's built-in rate limiting features.

## Security Considerations

1. **API Key Protection**: Never expose your Claude API key in client-side code
2. **CORS**: Configured to allow requests from any origin (`*`). For production, consider restricting to specific origins
3. **Rate Limiting**: Basic rate limiting is included, but consider additional protection for production
4. **Request Validation**: All requests are validated before forwarding to Claude API
5. **HTTPS Only**: Vercel automatically provides HTTPS for all deployments

## Troubleshooting

### "API key not configured on server"

- Make sure you've added `ANTHROPIC_API_KEY` to your Vercel environment variables
- Redeploy after adding environment variables

### CORS Errors

- Ensure you're using the correct proxy URL
- Check that `vercel.json` is properly configured
- Verify the proxy is deployed and accessible

### Rate Limit Errors

- Wait for the time specified in `Retry-After` header
- Consider implementing exponential backoff in your client code
- Adjust `RATE_LIMIT_REQUESTS` if needed

### Timeout Errors

- The proxy has a 30-second timeout for Claude API requests
- For longer responses, consider using streaming (requires additional implementation)

## Development

### Project Structure

```
figma-claude-proxy/
├── api/
│   └── claude-proxy.ts      # Main proxy handler
├── .env.example             # Environment variables template
├── .gitignore              # Git ignore rules
├── package.json            # Project dependencies
├── tsconfig.json           # TypeScript configuration
├── vercel.json             # Vercel deployment config
└── README.md               # This file
```

### Local Development

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Test the endpoint
curl -X POST http://localhost:3000/api/claude-proxy \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":100,"messages":[{"role":"user","content":"Hi"}]}'
```

### Deployment

```bash
# Deploy to production
npm run deploy

# Deploy to preview environment
vercel
```

## Cost Considerations

- This proxy doesn't add any costs beyond your Claude API usage
- Monitor your API usage in [Anthropic Console](https://console.anthropic.com)
- Vercel's free tier includes:
  - 100 GB bandwidth per month
  - 100 GB-hours of serverless function execution
  - Unlimited API requests

## Resources

- [Claude API Documentation](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [Vercel Documentation](https://vercel.com/docs)
- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- [Anthropic Console](https://console.anthropic.com)

## License

MIT

## Support

For issues and questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review [Claude API Documentation](https://docs.anthropic.com)
3. Check [Vercel Documentation](https://vercel.com/docs)

## Next Steps

Now that your proxy is set up, you can start building your Figma plugin! The proxy handles all the complexity of API key management and CORS, so you can focus on creating an amazing plugin experience.

Happy building!
