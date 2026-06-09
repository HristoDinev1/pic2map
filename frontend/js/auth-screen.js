import { el, mount, clear } from './dom.js';
import { auth } from './auth.js';
import { authStore } from './auth-store.js';

/**
 * Renders a sign-in / sign-up / confirm-account screen into `node` and resolves
 * once the user is authenticated. Mirrors what @aws-amplify/ui-react's
 * <Authenticator> used to gate the app with — reimplemented with plain fetch
 * calls to Cognito (see auth.js) since external UI libraries aren't allowed.
 */
export function renderAuthScreen(node, onSignedIn) {
  let mode = 'signIn'; // signIn | signUp | confirm | forgot | reset
  let pendingUsername = '';
  let message = '';
  let error = '';

  const field = (props) => el('input', { class: 'mb-1', ...props });

  function draw() {
    const wrap = el('div', { class: 'auth-wrap card' });
    const title = {
      signIn: 'Sign in to PIC2MAP',
      signUp: 'Create an account',
      confirm: 'Confirm your account',
      forgot: 'Reset your password',
      reset: 'Choose a new password',
    }[mode];

    wrap.append(el('h1', {}, title));
    if (error) wrap.append(el('p', { class: 'error' }, error));
    if (message) wrap.append(el('p', { class: 'success mb-2' }, message));

    const form = el('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); submit(); } });

    if (mode === 'signIn' || mode === 'signUp' || mode === 'forgot') {
      form.append(field({ name: 'username', placeholder: 'Username', autocomplete: 'username', required: true }));
    }
    if (mode === 'signUp') {
      form.append(field({ name: 'email', type: 'email', placeholder: 'Email', autocomplete: 'email', required: true }));
    }
    if (mode === 'signIn' || mode === 'signUp' || mode === 'reset') {
      form.append(field({
        name: 'password', type: 'password',
        placeholder: mode === 'reset' ? 'New password' : 'Password',
        autocomplete: mode === 'signIn' ? 'current-password' : 'new-password', required: true,
      }));
    }
    if (mode === 'confirm' || mode === 'reset') {
      form.append(field({ name: 'code', placeholder: 'Confirmation code (sent by email)', required: true }));
    }

    const submitLabel = {
      signIn: 'Sign in', signUp: 'Create account', confirm: 'Confirm account',
      forgot: 'Send reset code', reset: 'Set new password',
    }[mode];
    form.append(el('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel));
    wrap.append(form);

    const links = el('div', { class: 'stack mt-2', style: 'font-size:0.8125rem' });
    if (mode === 'signIn') {
      links.append(el('button', { class: 'btn-text', onclick: () => switchMode('signUp') }, "Don't have an account? Sign up"));
      if (auth.supportsPasswordReset) {
        links.append(el('button', { class: 'btn-text', onclick: () => switchMode('forgot') }, 'Forgot your password?'));
      }
    } else if (mode === 'signUp') {
      links.append(el('button', { class: 'btn-text', onclick: () => switchMode('signIn') }, 'Already have an account? Sign in'));
      if (auth.supportsConfirmation) {
        links.append(el('button', { class: 'btn-text', onclick: () => switchMode('confirm') }, 'Have a confirmation code already?'));
      }
    } else if (mode === 'confirm') {
      links.append(
        el('button', { class: 'btn-text', onclick: resend }, 'Resend confirmation code'),
        el('button', { class: 'btn-text', onclick: () => switchMode('signIn') }, 'Back to sign in')
      );
    } else {
      links.append(el('button', { class: 'btn-text', onclick: () => switchMode('signIn') }, 'Back to sign in'));
    }
    wrap.append(links);

    mount(node, wrap);
    wrap.querySelector('input')?.focus();
  }

  function switchMode(next) { mode = next; error = ''; message = ''; draw(); }

  function values(form) {
    const data = {};
    for (const input of form.querySelectorAll('input')) data[input.name] = input.value.trim();
    return data;
  }

  async function resend() {
    if (!pendingUsername) { error = 'Enter your username first, then request a code.'; draw(); return; }
    try { await auth.resendCode(pendingUsername); message = 'Confirmation code re-sent — check your email.'; error = ''; }
    catch (e) { error = e.message; }
    draw();
  }

  async function submit() {
    error = ''; message = '';
    const form = node.querySelector('form');
    const v = values(form);
    try {
      if (mode === 'signIn') {
        await auth.signIn(v.username, v.password);
        await authStore.refresh();
        onSignedIn();
        return;
      }
      if (mode === 'signUp') {
        const result = await auth.signUp(v.username, v.password, v.email);
        pendingUsername = v.username;
        if (result && result.autoConfirmed) {
          mode = 'signIn';
          message = 'Account created — sign in below.';
        } else {
          mode = 'confirm';
          message = 'Account created — enter the confirmation code we emailed you.';
        }
        draw();
        return;
      }
      if (mode === 'confirm') {
        const username = pendingUsername || v.username;
        await auth.confirmSignUp(username, v.code);
        pendingUsername = username;
        mode = 'signIn';
        message = 'Account confirmed — sign in below.';
        draw();
        return;
      }
      if (mode === 'forgot') {
        await auth.forgotPassword(v.username);
        pendingUsername = v.username;
        mode = 'reset';
        message = 'Check your email for a reset code.';
        draw();
        return;
      }
      if (mode === 'reset') {
        await auth.confirmForgotPassword(pendingUsername, v.code, v.password);
        mode = 'signIn';
        message = 'Password updated — sign in with your new password.';
        draw();
        return;
      }
    } catch (e) {
      error = e.message || 'Something went wrong.';
      draw();
    }
  }

  // Track the username typed so confirm/forgot/reset flows can reuse it.
  node.addEventListener('input', (e) => {
    if (e.target.name === 'username') pendingUsername = e.target.value.trim();
  });

  clear(node);
  draw();
}
