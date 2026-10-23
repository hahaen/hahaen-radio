import i18n from './i18n';

i18n.addResourceBundle(
  'zh',
  'translation',
  {
    account: {
      title: '账号与同步',
      entry: '登录，跨设备同步收听',
      login: '登录 / 自动注册',
      logout: '退出登录',
      hint: '输入账号和密码即可登录，账号不存在时自动注册，并合并本机收藏与历史。不登录也能继续使用。',
      username: '账号',
      usernameHint:
        '3–32 位字母、数字或下划线，不区分大小写；test、admin 等系统名称及其前缀不可使用。',
      password: '密码',
      passwordHint: '15–128 个字符，支持粘贴和密码管理器。请妥善保存，暂不支持找回密码。',
      showPassword: '显示密码',
      hidePassword: '隐藏密码',
      working: '正在处理…',
      retry: '立即同步',
      cacheUnavailable: '当前浏览器无法暂存待同步内容，请等同步完成后再离开。',
      status: {
        checking: '正在检查登录状态…',
        guest: '本机收听',
        syncing: '正在同步…',
        synced: '已与账号同步',
        error: '同步未完成，内容暂留此标签页，可重试',
        expired: '登录已过期',
      },
      errors: {
        UNAUTHORIZED: '账号或密码不正确，请重试。',
        ACCOUNT_RESERVED: '此账号名称为系统保留名称，请换一个。',
        RATE_LIMITED: '尝试过于频繁，请稍后再试。',
        VALIDATION_ERROR: '请检查账号格式和密码长度。',
        SERVICE_UNAVAILABLE: '账号服务暂不可用，请稍后再试，本机收听不受影响。',
        NETWORK: '连接未成功，请检查网络后重试。',
        FORBIDDEN: '请求未通过验证，请刷新页面后重试。',
        CONFLICT: '其他设备正在更新，请重试同步。',
        expired: '登录状态已变化，请重新登录。未同步内容会在此标签页再次登录同一账号后重试。',
        UNSENT: '还有内容未同步，请重试成功后退出。',
        CACHE: '此标签页的待同步内容无法读取，请先保留页面并联系维护者。',
        CAPACITY: '合并后超出收藏容量，请先整理收藏。',
      },
    },
  },
  true,
  true,
);

i18n.addResourceBundle(
  'en',
  'translation',
  {
    account: {
      title: 'Account and sync',
      entry: 'Sign in to sync across devices',
      login: 'Sign in / create account',
      logout: 'Sign out',
      hint: 'Enter your username and password to sign in. A new username creates an account and merges local favorites and history. You can still listen without signing in.',
      username: 'Username',
      usernameHint:
        '3–32 letters, digits or underscores. Case insensitive. System names and prefixes such as test and admin are reserved.',
      password: 'Password',
      passwordHint:
        '15–128 characters. Paste and password managers are supported. Keep it safe; password recovery is not available yet.',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      working: 'Working…',
      retry: 'Sync now',
      cacheUnavailable: 'This browser cannot keep pending changes. Wait for sync before leaving.',
      status: {
        checking: 'Checking session…',
        guest: 'Local listening',
        syncing: 'Syncing…',
        synced: 'Synced with your account',
        error: 'Sync incomplete. Changes remain in this tab; retry when connected.',
        expired: 'Session expired',
      },
      errors: {
        UNAUTHORIZED: 'Incorrect username or password.',
        ACCOUNT_RESERVED: 'This username is reserved. Please choose another.',
        RATE_LIMITED: 'Too many attempts. Please try again later.',
        VALIDATION_ERROR: 'Check the username format and password length.',
        SERVICE_UNAVAILABLE: 'Account service is unavailable. Local listening still works.',
        NETWORK: 'Could not connect. Check your network and retry.',
        FORBIDDEN: 'Request could not be verified. Refresh and retry.',
        CONFLICT: 'Another device is updating. Retry sync.',
        expired:
          'Your session changed. Sign in again. Pending changes will retry when you sign into the same account in this tab.',
        UNSENT: 'Sync pending changes before signing out.',
        CACHE: 'Pending changes in this tab could not be read. Keep this page and contact support.',
        CAPACITY: 'The merged collection exceeds capacity. Remove some favorites first.',
      },
    },
  },
  true,
  true,
);
