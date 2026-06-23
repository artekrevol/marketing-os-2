import * as React from "react";

/**
 * Debug utilities for the application
 */

export const DEBUG_MODE = import.meta.env.MODE === 'development';

/**
 * Log message only in development mode
 */
export function debugLog(...args: any[]): void {
  if (DEBUG_MODE) {
    console.log('[DEBUG]', ...args);
  }
}

/**
 * Track performance of a function
 */
export function measurePerformance<T>(functionName: string, fn: () => T): T {
  if (!DEBUG_MODE) return fn();
  
  const startTime = performance.now();
  const result = fn();
  const endTime = performance.now();
  
  console.log(`[PERF] ${functionName} took ${endTime - startTime}ms`);
  return result;
}

/**
 * Create an error boundary component for catching React errors
 */
export class ErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ERROR BOUNDARY] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}