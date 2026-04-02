import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#202125] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#2a2c31] rounded-xl p-8 border border-white/10">
            <div className="flex flex-col items-center text-center">
              <div className="bg-red-500/10 p-4 rounded-full mb-4">
                <AlertCircle className="w-12 h-12 text-red-500" />
              </div>

              <h1 className="text-2xl font-bold text-white mb-2">
                Oops! Something went wrong
              </h1>

              <p className="text-gray-400 mb-6">
                We encountered an unexpected error. Don't worry, your data is safe.
              </p>

              {this.state.error && (
                <details className="w-full mb-6 text-left">
                  <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-300 transition">
                    Error details
                  </summary>
                  <div className="mt-2 p-3 bg-black/30 rounded text-xs text-red-400 overflow-auto max-h-32">
                    <pre>{this.state.error.toString()}</pre>
                    {this.state.errorInfo && (
                      <pre className="mt-2 text-gray-500">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    )}
                  </div>
                </details>
              )}

              <button
                onClick={this.handleReset}
                className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-full font-bold flex items-center gap-2 transition shadow-lg shadow-brand-500/30"
              >
                <RefreshCw className="w-5 h-5" />
                Try Again
              </button>

              <button
                onClick={() => window.location.href = '/'}
                className="mt-3 text-gray-400 hover:text-white text-sm transition"
              >
                Go to Homepage
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Functional wrapper for use in functional components
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
) => {
  return (props: P) => (
    <ErrorBoundary fallback={fallback}>
      <Component {...props} />
    </ErrorBoundary>
  );
};
