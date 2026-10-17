/// <reference types="vite/client" />
export const applicationBase = import.meta.env.BASE_URL;
export const applicationPath = (path: string) => applicationBase + path.replace(/^\/+/, '');
