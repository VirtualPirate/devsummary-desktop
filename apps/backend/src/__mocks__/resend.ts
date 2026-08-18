export class Resend {
  constructor(_apiKey: string) {}
  emails = {
    send: async (_opts: any) => ({ id: 'mock' }),
  };
  contacts = {
    create: async (_opts: any) => ({
      data: { id: 'mock-contact' },
      error: null,
    }),
  };
}
