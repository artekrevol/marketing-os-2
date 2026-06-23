
/**
 * API Debugging utilities
 */
import { debugLog } from './debugUtils';

/**
 * Wraps fetch with debugging capabilities
 */
export async function debugFetch(url: string, options?: RequestInit): Promise<Response> {
  const startTime = performance.now();
  debugLog(`🔄 Fetching: ${url}`);
  
  try {
    const response = await fetch(url, options);
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Clone the response to be able to read the body
    const clonedResponse = response.clone();
    
    // Try to parse response as JSON, silently fail if not JSON
    let responseData;
    try {
      responseData = await clonedResponse.json();
    } catch (e) {
      responseData = { nonJsonBody: true };
    }
    
    if (response.ok) {
      debugLog(`✅ Response from ${url} in ${duration.toFixed(2)}ms:`, responseData);
    } else {
      debugLog(`❌ Error from ${url} (${response.status}): `, responseData);
    }
    
    return response;
  } catch (error) {
    const endTime = performance.now();
    const duration = endTime - startTime;
    debugLog(`💥 Network error from ${url} in ${duration.toFixed(2)}ms:`, error);
    throw error;
  }
}

// Add utility to debug API issues by showing them to the user
export function showApiError(error: any, message = "An error occurred"): void {
  console.error("[API ERROR]", error);
  
  // Display a user-friendly error message
  // This assumes you have an error toast implementation 
  if (window.showToast) {
    window.showToast({
      title: "API Error",
      description: message,
      variant: "destructive"
    });
  }
}

// Add type to window
declare global {
  interface Window {
    showToast?: (params: { title: string; description: string; variant: string }) => void;
  }
}
