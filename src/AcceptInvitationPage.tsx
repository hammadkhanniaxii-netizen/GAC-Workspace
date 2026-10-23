import React, { useState, useEffect } from 'react';

interface AcceptInvitationPageProps {
  onAccepted: () => void;
  onNavigateToLogin: () => void;
}

interface InvitationDetails {
  email: string;
  name: string;
  role: string;
  department: string;
  title: string;
  employeeId: string;
  expiresAt: number;
}

export function AcceptInvitationPage({ onAccepted, onNavigateToLogin }: AcceptInvitationPageProps) {
  const [token, setToken] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);

  // Form state
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token') || '';
      const urlEmail = params.get('email') || '';

      setToken(urlToken);
      setEmail(urlEmail);

      if (!urlToken || !urlEmail) {
        setError('This invitation link is missing required parameters. Please ensure you clicked the full URL sent by your administrator.');
        setLoading(false);
        return;
      }

      // Validate token with server
      fetch('/api/auth/validate-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: urlToken, email: urlEmail }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (res.ok && data.valid) {
            setInvitation(data);
          } else {
            setError(data.error || 'This invitation link is invalid or has expired.');
          }
        })
        .catch((err) => {
          setError(err.message || 'Unable to connect to authentication server. Please check your network connection.');
        })
        .finally(() => {
          setLoading(false);
        });
    } catch (e: any) {
      setError('Failed to parse invitation link parameters.');
      setLoading(false);
    }
  }, []);

  // Password complexity checks
  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword);
  const isMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecial && isMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!isPasswordValid) {
      setFormError('Please ensure all password requirements are satisfied and passwords match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(true);
      } else {
        setFormError(data.error || 'Failed to complete account activation. Please try again or contact support.');
      }
    } catch (err: any) {
      setFormError(err.message || 'Network error occurred while submitting password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f4f6f8',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      color: '#0f293c'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #dce3e8',
        boxShadow: '0 4px 20px rgba(15, 41, 60, 0.08)',
        overflow: 'hidden'
      }}>
        {/* Header Bar */}
        <div style={{
          backgroundColor: '#0f293c',
          padding: '28px 24px 24px',
          textAlign: 'center',
          borderBottom: '3px solid #38a149'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '48px',
            height: '48px',
            borderRadius: '10px',
            backgroundColor: '#1b3f5c',
            color: '#ffffff',
            fontWeight: 800,
            fontSize: '18px',
            marginBottom: '12px',
            border: '1px solid rgba(255, 255, 255, 0.15)'
          }}>
            GA
          </div>
          <h1 style={{
            margin: '0 0 6px',
            color: '#ffffff',
            fontSize: '20px',
            fontWeight: 700,
            letterSpacing: '-0.02em'
          }}>
            Growth Alliance Consultancy
          </h1>
          <p style={{
            margin: 0,
            color: '#a3b8cc',
            fontSize: '13px'
          }}>
            GA Workspace — Corporate Account Activation
          </p>
        </div>

        {/* Card Body */}
        <div style={{ padding: '24px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '36px 0' }}>
              <div style={{
                display: 'inline-block',
                width: '32px',
                height: '32px',
                border: '3px solid #dce3e8',
                borderTopColor: '#38a149',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <p style={{ marginTop: '14px', fontSize: '13px', color: '#55697a' }}>
                Verifying your invitation security credentials...
              </p>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {!loading && error && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                backgroundColor: '#fbeae8',
                color: '#d93829',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                marginBottom: '14px'
              }}>
                ✕
              </div>
              <h2 style={{ fontSize: '17px', margin: '0 0 8px', color: '#0f293c' }}>
                Invitation Link Unavailable
              </h2>
              <p style={{ fontSize: '13px', color: '#55697a', lineHeight: '1.5', margin: '0 0 20px' }}>
                {error}
              </p>
              <button
                type="button"
                onClick={onNavigateToLogin}
                style={{
                  width: '100%',
                  padding: '11px 16px',
                  backgroundColor: '#0f293c',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Return to Login Portal
              </button>
            </div>
          )}

          {!loading && !error && success && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#e6f7ec',
                color: '#288439',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                marginBottom: '14px'
              }}>
                ✓
              </div>
              <h2 style={{ fontSize: '18px', margin: '0 0 8px', color: '#0f293c' }}>
                Account Successfully Activated!
              </h2>
              <p style={{ fontSize: '13px', color: '#55697a', lineHeight: '1.6', margin: '0 0 20px' }}>
                Your corporate password has been established and your account status is now <strong>Active</strong>. You can now log in using your work email (<strong>{email}</strong>) and your new password.
              </p>
              <button
                type="button"
                onClick={onAccepted}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: '#38a149',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Proceed to Sign In
              </button>
            </div>
          )}

          {!loading && !error && !success && invitation && (
            <div>
              {/* Profile Summary Box */}
              <div style={{
                backgroundColor: '#f7fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '14px 16px',
                marginBottom: '20px'
              }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#718096', fontWeight: 700, letterSpacing: '0.04em', marginBottom: '6px' }}>
                  Invited Member Profile
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f293c' }}>
                  {invitation.name}
                </div>
                <div style={{ fontSize: '12px', color: '#4a5568', marginTop: '2px' }}>
                  {invitation.email}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  <span style={{ fontSize: '11px', padding: '2px 8px', backgroundColor: '#e2e8f0', borderRadius: '4px', color: '#2d3748', fontWeight: 600 }}>
                    {invitation.title}
                  </span>
                  <span style={{ fontSize: '11px', padding: '2px 8px', backgroundColor: '#edf2f7', borderRadius: '4px', color: '#4a5568' }}>
                    {invitation.department}
                  </span>
                  <span style={{ fontSize: '11px', padding: '2px 8px', backgroundColor: '#edf2f7', borderRadius: '4px', color: '#4a5568' }}>
                    ID: {invitation.employeeId}
                  </span>
                </div>
              </div>

              {formError && (
                <div style={{
                  backgroundColor: '#fde8e8',
                  border: '1px solid #f8b4b4',
                  color: '#9b1c1c',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  marginBottom: '16px'
                }}>
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#2d3748', marginBottom: '6px' }}>
                    Establish Permanent Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new strong password"
                      style={{
                        width: '100%',
                        padding: '10px 42px 10px 12px',
                        fontSize: '14px',
                        border: '1px solid #cbd5e0',
                        borderRadius: '6px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: '#718096',
                        fontSize: '12px',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#2d3748', marginBottom: '6px' }}>
                    Confirm Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: '14px',
                      border: '1px solid #cbd5e0',
                      borderRadius: '6px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                {/* Password Policy Requirements Checklist */}
                <div style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #edf2f7',
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '20px',
                  fontSize: '12px'
                }}>
                  <div style={{ fontWeight: 600, color: '#4a5568', marginBottom: '6px' }}>
                    Security Policy Requirements:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                    <div style={{ color: hasMinLength ? '#288439' : '#a0aec0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{hasMinLength ? '✓' : '○'}</span> 8+ Characters
                    </div>
                    <div style={{ color: hasUppercase ? '#288439' : '#a0aec0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{hasUppercase ? '✓' : '○'}</span> Uppercase letter
                    </div>
                    <div style={{ color: hasLowercase ? '#288439' : '#a0aec0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{hasLowercase ? '✓' : '○'}</span> Lowercase letter
                    </div>
                    <div style={{ color: hasNumber ? '#288439' : '#a0aec0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{hasNumber ? '✓' : '○'}</span> Number (0-9)
                    </div>
                    <div style={{ color: hasSpecial ? '#288439' : '#a0aec0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{hasSpecial ? '✓' : '○'}</span> Special symbol
                    </div>
                    <div style={{ color: isMatch ? '#288439' : '#a0aec0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{isMatch ? '✓' : '○'}</span> Passwords match
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !isPasswordValid}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    backgroundColor: isPasswordValid ? '#38a149' : '#cbd5e0',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: isPasswordValid ? 'pointer' : 'not-allowed',
                    transition: 'background-color 0.2s'
                  }}
                >
                  {submitting ? 'Setting Password & Activating...' : 'Establish Password & Activate Account'}
                </button>
              </form>

              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={onNavigateToLogin}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '12px',
                    color: '#718096',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  Already have an active account? Sign in
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
