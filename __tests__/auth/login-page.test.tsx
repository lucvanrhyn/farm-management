// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * P4 — error message must live inside an ARIA live region so screen readers
 * announce credential failures (action-blocking → assertive).
 *
 * P1 — login page calls `/api/auth/login-check` BEFORE invoking signIn so the
 * browser never sees a 401 in DevTools/Network logs on bad credentials.
 */

const signInMock = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

const fetchMock = vi.fn();
const assignMock = vi.fn();

beforeEach(() => {
  signInMock.mockReset();
  fetchMock.mockReset();
  assignMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock },
  });
});

afterEach(() => cleanup());

async function loadLoginPage(): Promise<React.ComponentType> {
  const mod = await import('@/app/(auth)/login/page');
  return mod.default;
}

function fillAndSubmit(identifier = 'wrong@user.com', password = 'nope'): void {
  fireEvent.change(screen.getByLabelText(/email or username/i), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('login page — accessibility (P4) + 200-typed-payload flow (P1)', () => {
  it('renders the bad-credentials error inside an aria-live region with role="alert"', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, reason: 'INVALID_CREDENTIALS' }),
    });

    const LoginPage = await loadLoginPage();
    render(<LoginPage />);
    fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/incorrect email\/username or password/i);
    // Assertive — credential failures block the user from continuing,
    // so screen readers should interrupt instead of waiting for an idle moment.
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('calls /api/auth/login-check first; only invokes signIn() when ok:true', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    signInMock.mockResolvedValueOnce({ ok: true, error: null });

    const LoginPage = await loadLoginPage();
    render(<LoginPage />);
    fillAndSubmit('dicky', 'correct-horse');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/login-check',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        identifier: 'dicky',
        password: 'correct-horse',
        redirect: false,
      });
    });
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/farms'));
  });

  it('does NOT call signIn() when login-check returns ok:false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, reason: 'INVALID_CREDENTIALS' }),
    });

    const LoginPage = await loadLoginPage();
    render(<LoginPage />);
    fillAndSubmit();

    await screen.findByRole('alert');
    expect(signInMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('does not emit console.error noise on bad credentials', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, reason: 'INVALID_CREDENTIALS' }),
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const LoginPage = await loadLoginPage();
    render(<LoginPage />);
    fillAndSubmit();

    await screen.findByRole('alert');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('shows a network-error message inside the alert region when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const LoginPage = await loadLoginPage();
    render(<LoginPage />);
    fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/network error/i);
    consoleErrorSpy.mockRestore();
  });
});
