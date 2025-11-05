/**
 * Figma Design Agent Endpoint
 *
 * Handles AI agent requests from the Figma plugin
 * Streams responses including tool calls and results
 */

import { createDesignAgent } from './design-agent';

// Note: Edge runtime removed due to timeout issues. Using Node.js runtime instead.

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
    const body = await req.json();
    const {
      userPrompt,
      context,
      model = 'claude-sonnet-4',
      maxTokens = 4096
    } = body;

    // Validate required fields
    if (!userPrompt) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: userPrompt' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate ANTHROPIC_API_KEY
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('[AGENT] MISSING ANTHROPIC_API_KEY!');
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
      console.error('[AGENT] INVALID ANTHROPIC_API_KEY FORMAT!');
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

    console.log('[AGENT] ANTHROPIC_API_KEY exists:', !!apiKey);
    console.log('[AGENT] ANTHROPIC_API_KEY length:', apiKey.length);
    console.log('[AGENT] ANTHROPIC_API_KEY prefix:', apiKey.substring(0, 10) + '...');

    console.log('[AGENT] Agent request:', {
      model,
      promptLength: userPrompt.length,
      hasContext: !!context,
      contextKeys: context ? Object.keys(context) : []
    });

    // Create the agent with Figma context
    console.log('[AGENT] Creating design agent...');
    const { model: agentModel, tools, maxSteps, temperature, system } = createDesignAgent(context || {});

    // Import streamText dynamically to use with agent configuration
    const { streamText } = await import('ai');

    console.log('[AGENT] Executing agent with streamText...');

    // Execute agent with streaming
    const result = await streamText({
      model: agentModel,
      tools,
      maxSteps,
      temperature,
      system,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ],
      maxTokens,

      // Log tool calls for debugging
      onStepFinish: (step) => {
        console.log('[AGENT] Step completed:', {
          stepNumber: step.stepNumber,
          toolCalls: step.toolCalls?.map(tc => ({
            name: tc.toolName,
            args: Object.keys(tc.args)
          })),
          finishReason: step.finishReason
        });
      }
    });

    console.log('[AGENT] streamText completed successfully');

    // Return streaming response
    return result.toTextStreamResponse({
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error('Agent execution error:', error);

    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
        details: error.toString(),
        stack: error.stack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * USAGE FROM FIGMA PLUGIN:
 *
 * ```javascript
 * const response = await fetch('https://figma-claude-proxy-flax.vercel.app/api/agent-analyze', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     userPrompt: 'Check if this design is accessible',
 *     context: {
 *       pageData: { ... },
 *       selectedNodes: [ ... ],
 *       designSystem: { ... }
 *     },
 *     maxTokens: 4096
 *   })
 * });
 *
 * // Handle streaming response
 * const reader = response.body.getReader();
 * while (true) {
 *   const { done, value } = await reader.read();
 *   if (done) break;
 *   // Process streamed chunks
 * }
 * ```
 */
