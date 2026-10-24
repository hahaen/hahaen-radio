export const ACCOUNT_SESSION_MAX_AGE = 30 * 86400;
export const accountSessionExpiry = () => new Date(Date.now() + ACCOUNT_SESSION_MAX_AGE * 1000);
