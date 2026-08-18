/* eslint-disable @typescript-eslint/require-await */
export async function render(
  _component: any,
  options?: { plainText?: boolean },
): Promise<string> {
  if (options?.plainText) {
    return 'mock plain text email';
  }
  return '<html>mock email html</html>';
}
