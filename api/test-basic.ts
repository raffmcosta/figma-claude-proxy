/**
 * Basic test endpoint to verify Vercel Edge Runtime works
 */

export const runtime = 'edge';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: Request) {
  console.log('[TEST] Handler called');

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    console.log('[TEST] API Key exists:', !!apiKey);
    console.log('[TEST] API Key length:', apiKey?.length);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Test endpoint works!',
        apiKeyExists: !!apiKey,
        apiKeyLength: apiKey?.length,
        apiKeyPrefix: apiKey?.substring(0, 10)
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('[TEST] Error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}
