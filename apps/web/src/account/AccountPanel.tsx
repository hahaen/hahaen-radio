import '../locales/account';
import { useState, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, UserRound } from 'lucide-react';
import type { AccountController } from './controller';
import styles from './account.module.css';
export function AccountPanel({ account }: { account: AccountController }) {
  const { t } = useTranslation();
  const state = useStore(account.store);
  const [open, setOpen] = useState(false),
    [visible, setVisible] = useState(false);
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await account.authenticate(username, password);
    setPassword('');
  };
  return (
    <section className={styles.account} aria-label={t('account.title')}>
      {state.user ? (
        <>
          <div className={styles.heading}>
            <UserRound size={18} aria-hidden="true" />
            <strong>{state.user.username}</strong>
            <button
              disabled={state.busy}
              onClick={() => {
                void account.logout();
              }}
            >
              {t('account.logout')}
            </button>
          </div>
          <p role="status">{t(`account.status.${state.status}`)}</p>
          <div className={styles.actions}>
            <button
              disabled={state.busy || state.status === 'syncing'}
              onClick={() => {
                void account.sync();
              }}
            >
              {t('account.retry')}
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            className={styles.entry}
            aria-expanded={open}
            disabled={state.status === 'checking'}
            onClick={() => setOpen(!open)}
          >
            <UserRound size={18} aria-hidden="true" />
            {t('account.entry')}
          </button>
          {open && (
            <form
              onSubmit={(event) => {
                void submit(event);
              }}
            >
              <p>{t('account.hint')}</p>
              <label htmlFor="account-username">{t('account.username')}</label>
              <input
                id="account-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9_]{3,32}"
                aria-describedby="account-username-hint"
                value={username}
                disabled={state.busy}
                onChange={(event) => setUsername(event.target.value)}
              />
              <small id="account-username-hint">{t('account.usernameHint')}</small>
              <label htmlFor="account-password">{t('account.password')}</label>
              <div className={styles.password}>
                <input
                  id="account-password"
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  minLength={15}
                  maxLength={128}
                  aria-describedby="account-password-hint"
                  value={password}
                  disabled={state.busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={t(visible ? 'account.hidePassword' : 'account.showPassword')}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
              <small id="account-password-hint">{t('account.passwordHint')}</small>
              <button className={styles.submit} type="submit" disabled={state.busy}>
                {t(state.busy ? 'account.working' : 'account.login')}
              </button>
            </form>
          )}
        </>
      )}
      {state.error && (
        <p role="alert">
          {t(`account.errors.${state.error}`, { defaultValue: t('account.errors.NETWORK') })}
        </p>
      )}
      {state.cacheUnavailable && state.user && <p role="status">{t('account.cacheUnavailable')}</p>}
    </section>
  );
}
