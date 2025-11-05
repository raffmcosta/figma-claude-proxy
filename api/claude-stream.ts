/**
 * VERCEL AI SDK STREAMING ENDPOINT
 *
 * This file should be deployed to your proxy server (e.g., Vercel, Next.js API route)
 * Location: /api/claude-stream.ts
 *
 * Installation:
 * npm install ai @ai-sdk/anthropic
 *
 * Environment Variables Required:
 * - ANTHROPIC_API_KEY: Your Anthropic API key
 */

import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';

// Using Edge runtime (required for Web API Response type)
export const runtime = 'edge';
export const maxDuration = 60; // 60 seconds timeout

// CORS headers for Figma plugin
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: Request) {
  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { model, messages, maxTokens = 4096 } = await req.json();

    // Validate required fields
    if (!model || !messages) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: model, messages' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate messages array
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'messages must be a non-empty array' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate each message has role and content
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.role) {
        return new Response(
          JSON.stringify({
            error: `Message at index ${i} is missing 'role'`,
            message: msg
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      if (msg.content === undefined || msg.content === null || msg.content === '') {
        return new Response(
          JSON.stringify({
            error: `Message at index ${i} is missing or has empty 'content'`,
            message: { role: msg.role, contentType: typeof msg.content }
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Map model ID to Vercel AI SDK format
    const modelMap: Record<string, string> = {
      'claude-sonnet-4-5-20250929': 'claude-sonnet-4',
      'claude-haiku-4-5-20251001': 'claude-haiku-4',
      'claude-opus-4-1-20250805': 'claude-opus-4',
      'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
      'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
    };

    const mappedModel = modelMap[model] || model;

    // Validate ANTHROPIC_API_KEY
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('MISSING ANTHROPIC_API_KEY!');
      return new Response(
        JSON.stringify({
          error: 'Server configuration error: ANTHROPIC_API_KEY is not set',
          hint: 'Add ANTHROPIC_API_KEY to Vercel environment variables'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate API key format
    if (!apiKey.startsWith('sk-ant-')) {
      console.error('INVALID ANTHROPIC_API_KEY FORMAT!');
      return new Response(
        JSON.stringify({
          error: 'Server configuration error: ANTHROPIC_API_KEY has invalid format',
          hint: 'API key should start with sk-ant-'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('ANTHROPIC_API_KEY exists:', !!apiKey);
    console.log('ANTHROPIC_API_KEY length:', apiKey.length);
    console.log('ANTHROPIC_API_KEY prefix:', apiKey.substring(0, 10) + '...');

    // Detailed logging for debugging
    console.log('Streaming request:', {
      model: mappedModel,
      messageCount: messages.length,
      maxTokens,
    });

    console.log('Detailed messages structure:');
    messages.forEach((msg, index) => {
      console.log(`Message ${index}:`, {
        role: msg.role,
        contentType: typeof msg.content,
        isArray: Array.isArray(msg.content),
        contentLength: typeof msg.content === 'string'
          ? msg.content.length
          : (Array.isArray(msg.content) ? msg.content.length : 'N/A'),
        contentPreview: typeof msg.content === 'string'
          ? msg.content.substring(0, 100)
          : (Array.isArray(msg.content)
              ? msg.content.map(part => ({ type: part.type, hasImage: !!part.image, hasText: !!part.text }))
              : 'unknown'),
        fullContent: JSON.stringify(msg.content).substring(0, 500)
      });
    });

    // Create streaming response using Vercel AI SDK
    console.log('[STREAM] About to call streamText...');
    console.log('[STREAM] Model:', mappedModel);
    console.log('[STREAM] Messages count:', messages.length);

    let result;
    try {
      console.log('[STREAM] Calling streamText...');

      result = await streamText({
        model: anthropic(mappedModel),
        messages,
        temperature: 1,
      });
      console.log('[STREAM] streamText returned successfully');
    } catch (streamError) {
      console.error('[STREAM] streamText threw error:', streamError);
      console.error('[STREAM] Error details:', {
        name: streamError?.name,
        message: streamError?.message,
        stack: streamError?.stack?.substring(0, 500)
      });
      throw streamError;
    }

    console.log('[STREAM] Converting to text stream response...');

    // Return streaming response
    // The SDK handles SSE formatting automatically
    const response = result.toTextStreamResponse({
      headers: corsHeaders,
    });

    console.log('[STREAM] Response created, returning...');
    return response;

  } catch (error: any) {
    console.error('Streaming error:', error);

    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
        details: error.toString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * DEPLOYMENT INSTRUCTIONS:
 *
 * 1. Add this file to your Vercel project at: /api/claude-stream.ts
 *
 * 2. Install dependencies:
 *    npm install ai @ai-sdk/anthropic
 *
 * 3. Add environment variable to Vercel:
 *    ANTHROPIC_API_KEY=sk-ant-...
 *
 * 4. Deploy to Vercel:
 *    vercel --prod
 *
 * 5. Update the Figma plugin to use the new endpoint:
 *    const STREAM_URL = 'https://your-proxy.vercel.app/api/claude-stream';
 *
 * 6. Test the endpoint:
 *    curl -X POST https://your-proxy.vercel.app/api/claude-stream \
 *      -H "Content-Type: application/json" \
 *      -d '{
 *        "model": "claude-sonnet-4-5-20250929",
 *        "messages": [{"role": "user", "content": "Hello!"}],
 *        "maxTokens": 1024
 *      }'
 *
 * ALTERNATIVE: Next.js API Route
 *
 * If using Next.js instead of Vercel serverless:
 *
 * // /app/api/claude-stream/route.ts
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { streamText } from 'ai';
 *
 * export const runtime = 'edge';
 *
 * export async function POST(req: Request) {
 *   const { model, messages, maxTokens } = await req.json();
 *
 *   const result = await streamText({
 *     model: anthropic(model),
 *     messages,
 *     maxTokens,
 *   });
 *
 *   return result.toDataStreamResponse();
 * }
 */
