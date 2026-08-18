import { z } from "zod";

// ENV SCHEMA
const envSchema = z.object({
  apiBaseUri: z.string(),
});

export let globalEnv: z.infer<typeof envSchema>;

// VALIDATING ENV
const configureEnv = () => {
  const rawEnvObj = {
    apiBaseUri: import.meta.env.VITE_API_BASE_URI,
  };

  const parsedEnv = envSchema.safeParse(rawEnvObj);

  if (!parsedEnv.success) {
    const errorRes = parsedEnv as z.ZodSafeParseError<
      z.infer<typeof envSchema>
    >;
    console.error("!!ERROR IN LOADING ENVIRONMENT: ", errorRes.error.format());
  } else {
    globalEnv = parsedEnv.data;
  }
};

configureEnv();
