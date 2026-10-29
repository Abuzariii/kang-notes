// Entry point: sign in (or ?demo), then start the app.
import { initFirebase, authMessage } from './firebase.js';
import { createFirebaseStore, createLocalStore } from './store.js';
import { startApp, LOGO } from './app.js';
import { setupUpdates } from './pwa.js';
import { h } from './util.js';

// eslint-disable-next-line no-undef
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const params = new URLSearchParams(location.search);
let app = null;

setupUpdates({
  isBusy: () => Boolean(app?.isBusy()),
  onUpdateReady: (reload) => (app ? app.updateReady(reload) : reload()),
});

if (params.has('demo')) {
  app = startApp({ store: createLocalStore('kang-notes-demo'), source: 'demo', version });
} else {
  const fb = initFirebase();
  fb.onUser((user) => {
    if (app) return location.reload(); // signed out (or in as someone else): start clean
    if (!user) return showSignIn(fb);
    const store = createFirebaseStore(fb.db, user.uid, (err) => app?.error(err));
    app = startApp({ store, source: 'firebase', email: user.email, version, onSignOut: () => fb.signOut() });
  });
}

function showSignIn(fb) {
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'Email', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true });
  const message = h('p', { class: 'form-message', hidden: true });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const say = (text, ok = false) => {
    message.textContent = text;
    message.className = `form-message${ok ? ' ok' : ''}`;
    message.hidden = false;
  };
  const form = h('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        await fb.signIn(email.value.trim(), password.value);
      } catch (err) {
        say(authMessage(err));
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    },
  },
  h('span', { class: 'logo big', html: LOGO }),
  h('h1', null, 'kang-notes'),
  h('p', { class: 'muted' }, 'Sign in with the account you added in Firebase.'),
  email, password, message, submit,
  h('button', {
    class: 'link', type: 'button',
    onclick: async () => {
      try {
        await fb.resetPassword(email.value.trim());
        say('Check your email for a link to set a new password.', true);
      } catch (err) {
        say(authMessage(err));
      }
    },
  }, 'Forgot password?'));
  document.getElementById('app').replaceChildren(h('div', { class: 'signin' }, form));
  setTimeout(() => email.focus(), 50);
}
