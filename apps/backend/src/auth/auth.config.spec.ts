import { createAuth, AuthConfig } from './auth.config';

const baseConfig: AuthConfig = {
  db: {} as any,
  databaseUrl: 'postgresql://test:test@localhost:5432/test',
  secret: 'test-secret-for-unit-tests-only',
  baseURL: 'http://localhost:3000',
  trustedOrigins: ['http://localhost:3000', 'http://localhost:5173'],
  resendApiKey: 're_test',
  emailFrom: 'test@example.com',
  nodeEnv: 'test',
};

function getAuthOptions(config: AuthConfig): any {
  const auth = createAuth(config);
  return (auth as any).options;
}

describe('createAuth', () => {
  describe('Google OAuth', () => {
    it('should include socialProviders.google when both credentials are set', () => {
      const options = getAuthOptions({
        ...baseConfig,
        googleClientId: 'google-client-id',
        googleClientSecret: 'google-client-secret',
      });

      expect(options.socialProviders).toBeDefined();
      expect(options.socialProviders.google).toEqual({
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
      });
    });

    it('should configure account linking with google as trusted provider', () => {
      const options = getAuthOptions({
        ...baseConfig,
        googleClientId: 'google-client-id',
        googleClientSecret: 'google-client-secret',
      });

      expect(options.account).toBeDefined();
      expect(options.account.accountLinking).toEqual({
        enabled: true,
        trustedProviders: ['google'],
      });
    });

    it('should not include socialProviders when neither credential is set', () => {
      const options = getAuthOptions(baseConfig);

      expect(options.socialProviders).toBeUndefined();
      expect(options.account.accountLinking).toBeUndefined();
    });

    it('should not include socialProviders when only clientId is set', () => {
      const options = getAuthOptions({
        ...baseConfig,
        googleClientId: 'google-client-id',
      });

      expect(options.socialProviders).toBeUndefined();
      expect(options.account.accountLinking).toBeUndefined();
    });

    it('should not include socialProviders when only clientSecret is set', () => {
      const options = getAuthOptions({
        ...baseConfig,
        googleClientSecret: 'google-client-secret',
      });

      expect(options.socialProviders).toBeUndefined();
      expect(options.account.accountLinking).toBeUndefined();
    });
  });

  describe('databaseHooks', () => {
    it('should always include databaseHooks for token encryption', () => {
      const options = getAuthOptions(baseConfig);

      expect(options.databaseHooks).toBeDefined();
      expect(options.databaseHooks.account).toBeDefined();
      expect(options.databaseHooks.account.create.before).toBeInstanceOf(
        Function,
      );
      expect(options.databaseHooks.account.update.before).toBeInstanceOf(
        Function,
      );
    });
  });

  describe('config snapshot', () => {
    it('should match snapshot without Google OAuth', () => {
      const options = getAuthOptions(baseConfig);

      // Replace functions with markers for stable snapshots
      const serializable = JSON.parse(
        JSON.stringify(options, (_, value) =>
          typeof value === 'function' ? '[Function]' : value,
        ),
      );

      expect(serializable).toMatchSnapshot();
    });

    it('should match snapshot with Google OAuth', () => {
      const options = getAuthOptions({
        ...baseConfig,
        googleClientId: 'google-client-id',
        googleClientSecret: 'google-client-secret',
      });

      const serializable = JSON.parse(
        JSON.stringify(options, (_, value) =>
          typeof value === 'function' ? '[Function]' : value,
        ),
      );

      expect(serializable).toMatchSnapshot();
    });
  });

  describe('core config', () => {
    it('should always enable emailAndPassword', () => {
      const options = getAuthOptions(baseConfig);
      expect(options.emailAndPassword).toEqual({ enabled: true });
    });

    it('should include openAPI plugin in non-production', () => {
      const options = getAuthOptions({ ...baseConfig, nodeEnv: 'development' });
      expect(
        options.plugins.some((p: any) => p.id === 'open-api'),
      ).toBeTruthy();
    });

    it('should exclude openAPI plugin in production', () => {
      const options = getAuthOptions({ ...baseConfig, nodeEnv: 'production' });
      expect(options.plugins.some((p: any) => p.id === 'open-api')).toBeFalsy();
    });
  });
});
