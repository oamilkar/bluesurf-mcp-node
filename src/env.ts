/** Primera variable de entorno no vacía entre `names`. */
export function envValue(
  env: NodeJS.ProcessEnv,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value) return value;
  }
  return undefined;
}
