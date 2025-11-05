# 🚨 DEPLOYMENT PROTECTION IS BLOCKING ALL REQUESTS

## Root Cause

Vercel Deployment Protection is enabled on your project, which requires authentication to access **any** endpoint, including production. This is why all requests timeout - they're being redirected to an authentication page instead of executing.

## How to Fix (2 options)

### Option 1: Disable Deployment Protection (Recommended for Public API)

1. Go to your Vercel dashboard: https://vercel.com/raffael-costas-projects/figma-claude-proxy/settings/deployment-protection

2. Under **Deployment Protection**, you'll see:
   - Protection Method: SSO Protection (or Standard Protection)
   - Environments: Production, Preview, Development

3. Click on "Protection Method" and select **Vercel Authentication**

4. Under "Apply Protection to Environments", **UNCHECK "Production"**

   ✅ Preview: Protected (keep checked for preview deploys)
   ✅ Development: Protected (keep checked for dev)
   ❌ Production: **UNCHECKED** (your Figma plugin needs open access!)

5. Click "Save"

6. Wait 30 seconds for the change to propagate

7. Test: `curl https://figma-claude-proxy-flax.vercel.app/api/ping`
   - Should return: `{"status":"ok","timestamp":...}`

### Option 2: Use Password Protection Instead

If you want SOME protection but not SSO:

1. Go to Settings → Deployment Protection
2. Change "Protection Method" to **Password Protection**
3. Set a password
4. Update your Figma plugin to include password in headers:
   ```javascript
   headers: {
     'x-vercel-protection-bypass': 'YOUR_PASSWORD_HERE'
   }
   ```

## Why This Happened

Vercel projects default to having Deployment Protection enabled for security. This is great for web apps, but breaks API endpoints that need to be publicly accessible (like your Figma plugin proxy).

## Verification

After disabling protection, test each endpoint:

1. **Ping endpoint (simplest):**
   ```bash
   curl https://figma-claude-proxy-flax.vercel.app/api/ping
   ```
   Expected: `{"status":"ok","timestamp":1234567890}`

2. **Test basic endpoint:**
   ```bash
   curl -X POST https://figma-claude-proxy-flax.vercel.app/api/test-basic \
     -H "Content-Type: application/json" \
     -d '{}'
   ```
   Expected: JSON with `apiKeyExists`, `apiKeyLength`, `apiKeyPrefix`

3. **Test streaming endpoint:**
   ```bash
   curl -X POST https://figma-claude-proxy-flax.vercel.app/api/claude-stream \
     -H "Content-Type: application/json" \
     -d '{
       "model": "claude-sonnet-4-5-20250929",
       "messages": [{"role": "user", "content": "Say hello"}],
       "maxTokens": 100
     }'
   ```
   Expected: SSE streaming response with text chunks

## What About Security?

Since your Figma plugin is client-side, you can't hide API keys anyway. The ANTHROPIC_API_KEY is safely stored as an environment variable in Vercel and never exposed to the client.

If you're concerned about unauthorized usage, consider:
- Rate limiting (Vercel Edge Config)
- Usage monitoring (Vercel Analytics)
- API key rotation (change ANTHROPIC_API_KEY periodically)

## Next Steps

1. Disable production deployment protection (see Option 1 above)
2. Test the ping endpoint
3. Test the streaming endpoint
4. Test from your Figma plugin

You should see responses immediately instead of timeouts!
