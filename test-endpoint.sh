#!/bin/bash

# Test script for the claude-stream endpoint
# This will help diagnose API key issues

echo "Testing Figma Claude Proxy Endpoint..."
echo "======================================="
echo ""

# Test with a simple message
curl -X POST https://figma-claude-proxy-flax.vercel.app/api/claude-stream \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "messages": [
      {
        "role": "user",
        "content": "Say hello in one word"
      }
    ],
    "maxTokens": 100
  }' \
  --max-time 10 \
  --verbose

echo ""
echo "======================================="
echo "Test completed!"
echo ""
echo "Expected outcomes:"
echo "1. If API key is missing: 'ANTHROPIC_API_KEY is not set'"
echo "2. If API key format is wrong: 'ANTHROPIC_API_KEY has invalid format'"
echo "3. If API key is invalid: Anthropic API error"
echo "4. If everything works: Streaming response with 'hello'"
