export function seedNextCycle(options: { connectionString: string; apply?: boolean }): Promise<{
  mode: string;
  action: string;
  nextPosition: number;
  repeatFrom: number;
  totalWorkouts: number;
  pendingMigrations: string[];
}>;
