export function updateWorkouts(options: { connectionString: string; apply?: boolean }): Promise<{
  mode: string;
  action: string;
  sourceVersion: number;
  targetVersion: number;
  nextPosition: number;
  totalWorkouts: number;
  repeatFrom: number;
  changedWorkouts: number[];
  historyCounts: Record<string, number>;
}>;
