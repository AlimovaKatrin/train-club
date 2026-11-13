export function readDatabaseTarget(
  envFile: string,
  messages?: { missingUrlMessage?: string; protocolMessage?: string },
): Promise<{ connectionString: string; label: string }>;
