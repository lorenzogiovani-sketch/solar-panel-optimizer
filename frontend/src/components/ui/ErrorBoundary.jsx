import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const message = this.props.fallbackMessage || 'Si è verificato un errore imprevisto.';

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: "'Outfit', sans-serif",
            padding: 32,
            textAlign: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              fontSize: 40,
              lineHeight: 1,
              color: 'var(--red)',
            }}
          >
            !
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{message}</p>
          {this.state.error && (
            <p
              style={{
                fontSize: 11,
                color: 'var(--text3)',
                maxWidth: 400,
                wordBreak: 'break-word',
                margin: 0,
              }}
            >
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.handleReset}
            style={{
              marginTop: 8,
              padding: '8px 20px',
              borderRadius: 8,
              border: '1px solid var(--border-hi)',
              background: 'var(--surface)',
              color: 'var(--accent)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'Outfit', sans-serif",
              transition: 'all 0.2s',
            }}
          >
            Riprova
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
