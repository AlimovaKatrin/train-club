export function clearHistory(options: { connectionString: string; apply?: boolean }): Promise<{
  mode: 'check' | 'apply';
  sessions: number;
  exercises: number;
  sets: number;
  activities: { activity_type: string; count: number }[];
  workoutPosition: { before: number; after: number } | null;
}>;
