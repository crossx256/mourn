export const authRules = {
  username: (val: string) =>
    /^[a-z0-9_-]{3,30}$/.test(val) || '3-30 chars: lowercase, numbers, -, _',
  password: (val: string) => val.length >= 12 || 'Minimum 12 characters',
  email: (val: string) => !val || /.+@.+\..+/.test(val) || 'Invalid email format',
  referralCode: (val: string) =>
    /^mourn[A-F0-9]{16}$/.test(val) || 'Invalid invitation code format',
};
