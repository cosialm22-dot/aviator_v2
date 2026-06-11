/**
 * MPESA AUTH EDGE FUNCTION
 * 
 * Purpose: Get OAuth token from Safaricom Daraja API
 * Called by: All other M-Pesa functions
 * Caching: 55 minutes (token expires in 60)
 * 
 * Reasoning:
 * - Token is expensive to obtain (network round trip)
 * - Token is valid for 60 minutes
 * - Cache for 55 minutes to ensure freshness
 * - All other functions depend on this token
 * 
 * Error Handling:
 * - Network timeout: Retry 3x with exponential backoff
 * - Invalid credentials: Log and throw
 * - Rate limit (429): Wait 60s and retry once
 * - Other errors: Log and throw
 * 
 * Security:
 * - Credentials from environment variables only
 * - Never log credentials
 * - HTTPS only
 * - Timeout: 30 seconds
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ============================================
// TYPES
// ============================================

interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// ============================================
// GLOBAL STATE (Token Cache)
// ============================================

let tokenCache: CachedToken | null = null;

// ============================================
// CONSTANTS
// ============================================

const DARAJA_AUTH_URL = "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
const DARAJA_PRODUCTION_AUTH_URL = "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
const TOKEN_CACHE_DURATION_MS = 55 * 60 * 1000; // 55 minutes
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // Exponential backoff

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Log with timestamp and context
 */
function log(level: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const context = data ? JSON.stringify(data) : "";
  console.log(`[${timestamp}] [${level}] ${message} ${context}`);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build Basic Auth header
 * Reasoning: Daraja API requires Basic Auth with Consumer Key:Consumer Secret
 */
function buildAuthHeader(consumerKey: string, consumerSecret: string): string {
  const credentials = `${consumerKey}:${consumerSecret}`;
  const encoded = btoa(credentials); // Base64 encode
  return `Basic ${encoded}`;
}

/**
 * Check if cached token is still valid
 * Reasoning: Avoid unnecessary API calls by reusing valid tokens
 */
function isCachedTokenValid(): boolean {
  if (!tokenCache) {
    return false;
  }
  const now = Date.now();
  return now < tokenCache.expiresAt;
}

/**
 * Get cached token if valid
 */
function getCachedToken(): string | null {
  if (isCachedTokenValid() && tokenCache) {
    log("INFO", "Using cached token");
    return tokenCache.token;
  }
  return null;
}

/**
 * Cache token with expiry
 */
function cacheToken(token: string): void {
  tokenCache = {
    token,
    expiresAt: Date.now() + TOKEN_CACHE_DURATION_MS,
  };
  log("INFO", "Token cached for 55 minutes");
}

/**
 * Fetch token from Daraja with retry logic
 * Reasoning: Network can be unreliable, retry with exponential backoff
 */
async function fetchTokenFromDaraja(
  authUrl: string,
  authHeader: string,
  retryCount: number = 0
): Promise<OAuthTokenResponse> {
  try {
    log("INFO", `Fetching token from Daraja (attempt ${retryCount + 1}/${MAX_RETRIES})`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(authUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle rate limiting (429)
    if (response.status === 429) {
      log("WARN", "Rate limited by Daraja (429)");
      if (retryCount < MAX_RETRIES - 1) {
        log("INFO", "Waiting 60 seconds before retry");
        await sleep(60000);
        return fetchTokenFromDaraja(authUrl, authHeader, retryCount + 1);
      }
      throw new Error("Rate limited: max retries exceeded");
    }

    // Handle authentication errors (401)
    if (response.status === 401) {
      log("ERROR", "Invalid credentials (401)");
      throw new Error("Invalid M-Pesa credentials");
    }

    // Handle server errors (5xx)
    if (response.status >= 500) {
      log("WARN", `Server error from Daraja (${response.status})`);
      if (retryCount < MAX_RETRIES - 1) {
        const delay = RETRY_DELAYS_MS[retryCount];
        log("INFO", `Retrying after ${delay}ms`);
        await sleep(delay);
        return fetchTokenFromDaraja(authUrl, authHeader, retryCount + 1);
      }
      throw new Error(`Daraja server error: ${response.status}`);
    }

    // Handle other errors
    if (!response.ok) {
      log("ERROR", `Daraja error: ${response.status}`);
      throw new Error(`Daraja error: ${response.status}`);
    }

    const data = (await response.json()) as OAuthTokenResponse;

    // Validate response
    if (!data.access_token || !data.expires_in) {
      log("ERROR", "Invalid token response from Daraja");
      throw new Error("Invalid token response");
    }

    log("INFO", "Token obtained successfully", { expiresIn: data.expires_in });
    return data;
  } catch (error) {
    // Handle timeout
    if (error instanceof DOMException && error.name === "AbortError") {
      log("WARN", "Request timeout");
      if (retryCount < MAX_RETRIES - 1) {
        const delay = RETRY_DELAYS_MS[retryCount];
        log("INFO", `Retrying after ${delay}ms`);
        await sleep(delay);
        return fetchTokenFromDaraja(authUrl, authHeader, retryCount + 1);
      }
      throw new Error("Request timeout: max retries exceeded");
    }

    // Re-throw other errors
    throw error;
  }
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
  try {
    // Only allow GET requests
    if (req.method !== "GET") {
      log("WARN", `Invalid method: ${req.method}`);
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    log("INFO", "Auth request received");

    // Get environment variables
    const consumerKey = Deno.env.get("MPESA_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("MPESA_CONSUMER_SECRET");
    const environment = Deno.env.get("MPESA_ENVIRONMENT") || "sandbox";

    // Validate environment variables
    if (!consumerKey || !consumerSecret) {
      log("ERROR", "Missing M-Pesa credentials in environment");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check cached token first
    const cachedToken = getCachedToken();
    if (cachedToken) {
      return new Response(
        JSON.stringify({
          access_token: cachedToken,
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Determine auth URL based on environment
    const authUrl = environment === "production" ? DARAJA_PRODUCTION_AUTH_URL : DARAJA_AUTH_URL;
    log("INFO", `Using ${environment} environment`);

    // Build auth header
    const authHeader = buildAuthHeader(consumerKey, consumerSecret);

    // Fetch token from Daraja
    const tokenResponse = await fetchTokenFromDaraja(authUrl, authHeader);

    // Cache token
    cacheToken(tokenResponse.access_token);

    // Return token
    return new Response(
      JSON.stringify({
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    log("ERROR", "Unhandled error", { error: String(error) });
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * DEPLOYMENT INSTRUCTIONS
 * 
 * 1. Create directory:
 *    mkdir -p supabase/functions/mpesa-auth
 * 
 * 2. Save this file as:
 *    supabase/functions/mpesa-auth/index.ts
 * 
 * 3. Deploy:
 *    supabase functions deploy mpesa-auth
 * 
 * 4. Test locally:
 *    supabase functions serve
 *    curl http://localhost:54321/functions/v1/mpesa-auth
 * 
 * 5. Verify in production:
 *    curl https://your-project.supabase.co/functions/v1/mpesa-auth
 */
