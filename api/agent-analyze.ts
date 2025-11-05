/**
 * Figma Design Agent Endpoint
 *
 * Handles AI agent requests from the Figma plugin
 * Streams responses including tool calls and results
 */

import { createDesignAgent } from './design-agent';

// Vercel Edge Runtime for optimal streaming
export const runtime = 'edge';

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

    console.log('Agent request:', {
      model,
      promptLength: userPrompt.length,
      hasContext: !!context,
      contextKeys: context ? Object.keys(context) : []
    });

    // Create the agent with Figma context
    const { model: agentModel, tools, maxSteps, temperature, system } = createDesignAgent(context || {});

    // Import streamText dynamically to use with agent configuration
    const { streamText } = await import('ai');

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
        console.log('Agent step completed:', {
          stepNumber: step.stepNumber,
          toolCalls: step.toolCalls?.map(tc => ({
            name: tc.toolName,
            args: Object.keys(tc.args)
          })),
          finishReason: step.finishReason
        });
      }
    });

    // Return streaming response
    return result.toDataStreamResponse({
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
