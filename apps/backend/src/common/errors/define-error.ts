/**
 * Builds typed `AppError` factories from a single registry object.
 *
 * `defineError` describes one error (status, message, optional details) without
 * repeating the wire `code` string. `sealRegistry` walks the object keys and uses
 * each key as the `code` passed to `ApiException`, so the registry name and the
 * client-facing code never drift apart.
 *
 * The `SPEC` symbol tags specs so they are not confused with plain objects at the
 * type level. `Factory` / `SealedRegistry` are conditional types only: they shape
 * call signatures (`()` vs `(args)`) for TypeScript; the runtime is a simple loop
 * plus functions that build `ApiException`.
 */
import { ApiException } from './api-errors';

export type ErrorSpec<A> = {
  status: number;
  message: string | ((args: A) => string);
  details?: (args: A) => Record<string, unknown>;
};

const SPEC: unique symbol = Symbol('ErrorSpec');

export type SpecCarrier<A> = { readonly [SPEC]: ErrorSpec<A> };

export function defineError<A = void>(spec: ErrorSpec<A>): SpecCarrier<A> {
  return { [SPEC]: spec };
}

type Factory<C extends SpecCarrier<unknown>> =
  C extends SpecCarrier<infer A>
    ? [A] extends [void]
      ? () => ApiException
      : Partial<A> extends A
        ? (args?: A) => ApiException
        : (args: A) => ApiException
    : never;

export type SealedRegistry<R extends Record<string, SpecCarrier<unknown>>> = {
  [K in keyof R]: Factory<R[K]>;
};

export function sealRegistry<R extends Record<string, SpecCarrier<unknown>>>(
  carriers: R,
): SealedRegistry<R> {
  const out: Record<string, (args?: unknown) => ApiException> = {};
  for (const code of Object.keys(carriers)) {
    const spec = carriers[code][SPEC];
    out[code] = (args?: unknown) => {
      const message =
        typeof spec.message === 'function' ? spec.message(args) : spec.message;
      const details = spec.details ? spec.details(args) : undefined;
      return new ApiException(code, message, spec.status, details);
    };
  }
  return out as SealedRegistry<R>;
}
